// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

/**
 * Estoque × vendas offline PENDENTES durante a sincronização paginada (PostgreSQL de teste + IndexedDB simulado).
 * Reproduz o que o PDV faz: a venda offline baixa `estoque_local` e entra na fila na mesma transação; o servidor só
 * desconta quando a venda é enviada (gatilho em itens_venda). A fila é processada pelo worker REAL
 * (`processarFilaSincronizacao`), com um "servidor" que grava a venda de verdade no PostgreSQL de teste.
 */
const ctl = vi.hoisted(() => ({
  chamadas: [] as { entidade: string; vendas_locais?: string[] }[],
  /** Antes de o servidor ler a página (depois de o aparelho já ter pedido). */
  antesDaLeitura: null as null | ((entidade: string, n: number) => Promise<void>),
  /** Depois de o servidor ler, antes de a resposta chegar ao aparelho. */
  depoisDaLeitura: null as null | ((entidade: string, n: number) => Promise<void>),
}));

vi.mock("@/lib/offline-sync/actions", async () => {
  const { validarEntradaPagina } = await import("@/lib/offline-sync/validar-pagina");
  const { instantesDaRodada, lerPaginaCatalogo } = await import("@/services/catalogo-sync.service");
  return {
    buscarPaginaCatalogoAction: async (entrada: unknown) => {
      const v = validarEntradaPagina(entrada);
      ctl.chamadas.push({ entidade: v.entidade, vendas_locais: v.vendas_locais });
      const n = ctl.chamadas.length;
      if (ctl.antesDaLeitura) await ctl.antesDaLeitura(v.entidade, n);
      const instantes = v.ate ? null : await instantesDaRodada();
      const ate = v.ate ?? (instantes as { ate: string }).ate;
      const { itens, proximo, vendas_no_servidor } = await lerPaginaCatalogo(v.entidade, { desde: v.desde, ate, apos: v.apos }, v.tamanho, v.vendas_locais);
      if (ctl.depoisDaLeitura) await ctl.depoisDaLeitura(v.entidade, n);
      return { ate, marca: instantes?.marca, itens, proximo, vendas_no_servidor };
    },
    buscarCredenciaisPinOfflineAction: async () => ({ ok: true, credenciais: [] }),
    sincronizarOperacaoCaixaAction: async () => ({ sucesso: true }),
  };
});
vi.mock("@/lib/offline-sync/sincronizar-venda-action", () => ({ sincronizarVendaAction: async () => ({ sucesso: false, erro: "não usado" }) }));
vi.mock("@/lib/caixa/actions", () => ({ sincronizarOperacaoCaixaAction: async () => ({ sucesso: true }) }));

import { randomUUID } from "node:crypto";
import { prisma } from "@/services/prisma/client";
import { getOfflineDB } from "../db";
import { definirConfiguracao } from "../configuracao-local.service";
import { sincronizarCatalogo } from "../sincronizacao-catalogo.service";
import { processarFilaSincronizacao } from "../worker-sincronizacao.service";
import type { PayloadVendaFila } from "@/lib/offline-sync/sincronizar-venda-action";

const CARIMBO = "ultima_sincronizacao_catalogo";
const VERSAO = "versao_sincronizacao_catalogo";

let categoria = "";
let funcionario = "";
let produtos: string[] = []; // em ordem de id (a ordem em que o estoque é paginado)

async function limparServidor() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "movimentacoes_estoque", "itens_venda", "vendas", "produtos", "clientes", "categorias", "funcionarios" RESTART IDENTITY CASCADE'
  );
}
async function limparAparelho() {
  const db = getOfflineDB();
  await Promise.all([
    db.produtos_local.clear(), db.categorias_local.clear(), db.estoque_local.clear(), db.funcionarios_local.clear(),
    db.clientes_local.clear(), db.configuracoes_local.clear(), db.eventos_sincronizacao.clear(), db.fila_sincronizacao.clear(),
    db.vendas_locais.clear(),
  ]);
}

async function criarCatalogo(n: number, saldo = 10) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO produtos (nome, categoria_id, preco_venda) SELECT 'Produto ' || g, '${categoria}'::uuid, 5 FROM generate_series(1, ${n}) g`
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, funcionario_id) SELECT id, 'entrada', ${saldo}, '${funcionario}'::uuid FROM produtos`
  );
  produtos = (await prisma.produto.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((p) => p.id);
}

/** Como o PDV (vendas-local.service): baixa o saldo local e enfileira, na MESMA transação. */
async function venderOffline(produtoId: string, quantidade: number, status: "pendente" | "em_revisao" = "pendente"): Promise<string> {
  const db = getOfflineDB();
  const id = randomUUID();
  const criado = new Date().toISOString();
  const payload: PayloadVendaFila = { funcionario_id: funcionario, forma_pagamento: "dinheiro", total: 5 * quantidade, itens: [{ produto_id: produtoId, quantidade, preco_unitario: 5 }] };
  await db.transaction("rw", [db.estoque_local, db.fila_sincronizacao], async () => {
    const atual = await db.estoque_local.get(produtoId);
    await db.estoque_local.put({ produto_id: produtoId, quantidade_atual: (atual?.quantidade_atual ?? 0) - quantidade, estoque_minimo: atual?.estoque_minimo ?? 0, updated_at: criado });
    await db.fila_sincronizacao.put({ id, tipo: "venda", payload: JSON.stringify(payload), status, tentativas: 0, criado_em: criado, ultima_tentativa_em: null, erro: null });
  });
  return id;
}

/** O "servidor" do worker: grava a venda de verdade (o gatilho gera a baixa no estoque), idempotente pelo id. */
async function enviarAoServidor(id: string, p: PayloadVendaFila) {
  const existe = await prisma.venda.findUnique({ where: { id }, select: { id: true } });
  if (existe) return { sucesso: true, jaExistia: true };
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`INSERT INTO vendas (id, funcionario_id, forma_pagamento, total) VALUES ('${id}'::uuid, '${p.funcionario_id}'::uuid, 'dinheiro', ${p.total})`);
    for (const i of p.itens) {
      await tx.$executeRawUnsafe(`INSERT INTO itens_venda (venda_id, produto_id, quantidade, preco_unitario) VALUES ('${id}'::uuid, '${i.produto_id}'::uuid, ${i.quantidade}, ${i.preco_unitario})`);
    }
  });
  return { sucesso: true };
}
const enviarFila = () => processarFilaSincronizacao(enviarAoServidor as never, 5000, (async () => ({ sucesso: true })) as never);

const saldoLocal = async (id: string) => (await getOfflineDB().estoque_local.get(id))?.quantidade_atual;
const saldoServidor = async (id: string) =>
  Number((await prisma.$queryRaw<{ q: number }[]>`SELECT quantidade_atual AS q FROM estoque_atual WHERE produto_id = ${id}::uuid`)[0].q);
/** Força uma rodada COMPLETA (como um aparelho novo ou do protocolo antigo): todos os saldos voltam a ser enviados. */
async function esquecerCursor() {
  const db = getOfflineDB();
  await db.configuracoes_local.delete(CARIMBO);
  await db.configuracoes_local.delete(VERSAO);
}

beforeEach(async () => {
  ctl.chamadas = [];
  ctl.antesDaLeitura = null;
  ctl.depoisDaLeitura = null;
  await limparServidor();
  await limparAparelho();
  categoria = (await prisma.categoria.create({ data: { nome: "Geral" } })).id;
  funcionario = (await prisma.funcionario.create({ data: { nome: "Caixa", cargo: "gerente", pin_hash: "x" } })).id;
});

afterAll(async () => {
  await limparServidor();
  await prisma.$disconnect();
});

describe("venda offline pendente × sincronização do estoque", () => {
  it("o saldo local da venda pendente é preservado; depois do envio fica igual ao do servidor (sem baixa dupla)", async () => {
    await criarCatalogo(10);
    expect((await sincronizarCatalogo()).sucesso).toBe(true);
    const p = produtos[3];
    expect(await saldoLocal(p)).toBe(10);

    const venda = await venderOffline(p, 3);
    expect(await saldoLocal(p)).toBe(7);
    expect(await saldoServidor(p)).toBe(10); // o servidor ainda não sabe da venda

    await esquecerCursor(); // rodada completa: o saldo do servidor (10) é enviado de novo
    expect((await sincronizarCatalogo()).sucesso).toBe(true);
    expect(await saldoLocal(p)).toBe(7); // ANTES da correção voltava a 10 (venda "desfeita")
    expect(await saldoLocal(produtos[0])).toBe(10); // quem não vendeu segue igual ao servidor

    await enviarFila();
    expect(await saldoServidor(p)).toBe(7);
    expect(await getOfflineDB().fila_sincronizacao.get(venda).then((i) => i?.status)).toBe("sincronizado");

    await sincronizarCatalogo();
    expect(await saldoLocal(p)).toBe(7);
    await esquecerCursor();
    await sincronizarCatalogo();
    expect(await saldoLocal(p)).toBe(7); // ainda 7: nenhuma baixa em dobro
    expect(await prisma.venda.count()).toBe(1);
    expect(await prisma.movimentacaoEstoque.count({ where: { tipo: "venda" } })).toBe(1);
  });

  it("várias páginas de estoque: vendas pendentes em produtos de páginas diferentes, todas preservadas", async () => {
    await criarCatalogo(1150);
    const alvos = [produtos[10], produtos[600], produtos[1100]];
    for (const [i, a] of alvos.entries()) await venderOffline(a, i + 1);
    await esquecerCursor();
    const r = await sincronizarCatalogo();
    expect(r.sucesso).toBe(true);
    expect(ctl.chamadas.filter((c) => c.entidade === "estoque").length).toBe(3); // 3 páginas de estoque
    expect(await saldoLocal(alvos[0])).toBe(9);
    expect(await saldoLocal(alvos[1])).toBe(8);
    expect(await saldoLocal(alvos[2])).toBe(7);
    expect(await getOfflineDB().estoque_local.count()).toBe(1150);
    expect(await getOfflineDB().fila_sincronizacao.where("status").equals("pendente").count()).toBe(3); // nenhuma venda perdida
  });

  it("venda feita DURANTE a sincronização longa (entre páginas): saldo correto antes e depois da página dela", async () => {
    await criarCatalogo(1150);
    const antes = produtos[5]; // página 1 (já gravada quando a venda acontece)
    const depois = produtos[1000]; // página 3 (ainda não lida quando a venda acontece)
    let feito = false;
    ctl.depoisDaLeitura = async (entidade) => {
      if (entidade !== "estoque" || feito) return;
      feito = true; // dispara depois da 1ª leitura de estoque; a venda de `antes` só acontece APÓS a gravação dela:
    };
    // venda em `antes` acontece quando a 2ª página de estoque é pedida (a 1ª já foi gravada); em `depois` na mesma hora
    let pagina = 0;
    ctl.antesDaLeitura = async (entidade) => {
      if (entidade !== "estoque") return;
      pagina++;
      if (pagina === 2) {
        await venderOffline(antes, 2);
        await venderOffline(depois, 4);
      }
    };
    await esquecerCursor();
    expect((await sincronizarCatalogo()).sucesso).toBe(true);
    expect(await saldoLocal(antes)).toBe(8); // a baixa local vale por cima da página já gravada
    expect(await saldoLocal(depois)).toBe(6); // e a página 3 foi pedida com a venda na fila: saldo do servidor − venda
    expect(await getOfflineDB().fila_sincronizacao.count()).toBe(2);
  });

  it("venda que aparece ENTRE o pedido e a gravação da página: a página é pedida de novo e a baixa conta uma vez só", async () => {
    await criarCatalogo(10);
    const p = produtos[2];
    let feito = false;
    ctl.depoisDaLeitura = async (entidade) => {
      if (entidade !== "estoque" || feito) return;
      feito = true;
      await venderOffline(p, 3); // depois de o servidor ler os saldos, antes de a página chegar
    };
    await esquecerCursor();
    expect((await sincronizarCatalogo()).sucesso).toBe(true);
    expect(ctl.chamadas.filter((c) => c.entidade === "estoque").length).toBe(2); // pediu de novo
    expect(await saldoLocal(p)).toBe(7);
  });

  it("venda enviada ao servidor ENTRE o pedido e a leitura: o servidor informa que já a tem e o saldo não é abatido em dobro", async () => {
    await criarCatalogo(10);
    const p = produtos[4];
    await sincronizarCatalogo();
    const venda = await venderOffline(p, 3);
    let feito = false;
    ctl.antesDaLeitura = async (entidade) => {
      if (entidade !== "estoque" || feito) return;
      feito = true;
      await enviarFila(); // a venda chega ao servidor depois de o aparelho já ter pedido
    };
    await esquecerCursor();
    ctl.chamadas = [];
    expect((await sincronizarCatalogo()).sucesso).toBe(true);
    expect(ctl.chamadas.find((c) => c.entidade === "estoque")?.vendas_locais).toEqual([venda]);
    expect(await saldoServidor(p)).toBe(7);
    expect(await saldoLocal(p)).toBe(7); // 7, e não 4
  });

  it("venda retida para revisão não é reservada: o saldo segue o servidor (que não a gravou)", async () => {
    await criarCatalogo(5);
    await sincronizarCatalogo();
    const p = produtos[1];
    await venderOffline(p, 2, "em_revisao");
    await esquecerCursor();
    await sincronizarCatalogo();
    expect(await saldoLocal(p)).toBe(10);
  });

  it("repetir a sincronização com venda pendente não muda o saldo nem toca na fila", async () => {
    await criarCatalogo(20);
    const p = produtos[7];
    const venda = await venderOffline(p, 2);
    const payloadAntes = (await getOfflineDB().fila_sincronizacao.get(venda))?.payload;
    for (let i = 0; i < 3; i++) {
      await esquecerCursor();
      expect((await sincronizarCatalogo()).sucesso).toBe(true);
      expect(await saldoLocal(p)).toBe(8);
    }
    const item = await getOfflineDB().fila_sincronizacao.get(venda);
    expect(item?.status).toBe("pendente");
    expect(item?.payload).toBe(payloadAntes);
    await enviarFila();
    await enviarFila(); // reenvio: o servidor é idempotente pelo id
    expect(await prisma.venda.count()).toBe(1);
    expect(await saldoServidor(p)).toBe(8);
  });

  it("o contrato recusa lista de vendas fora do estoque ou com ids inválidos", async () => {
    const { validarEntradaPagina } = await import("@/lib/offline-sync/validar-pagina");
    const base = { desde: null, ate: null, apos: null };
    expect(() => validarEntradaPagina({ ...base, entidade: "produtos", vendas_locais: [randomUUID()] })).toThrow();
    expect(() => validarEntradaPagina({ ...base, entidade: "estoque", vendas_locais: ["1 OR 1=1"] })).toThrow();
    expect(validarEntradaPagina({ ...base, entidade: "estoque", vendas_locais: [randomUUID()] }).vendas_locais).toHaveLength(1);
    await definirConfiguracao("x", "y");
  });
});
