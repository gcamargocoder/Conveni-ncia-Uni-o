// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

/**
 * Sincronização PAGINADA do catálogo offline, de ponta a ponta: PostgreSQL de teste (npm run test:integracao) no
 * servidor + IndexedDB simulado (fake-indexeddb) no aparelho. A única peça trocada é a camada de autenticação da
 * Server Action (a paginação, a validação e as consultas SQL são as de produção); o `ctl` permite derrubar a
 * "internet" numa página, inserir dados durante a paginação e medir concorrência.
 */
const ctl = vi.hoisted(() => ({
  chamadas: [] as { entidade: string; desde: string | null; ate: string | null; apos: { t: string | null; id: string } | null }[],
  falharNaChamada: null as number | null,
  aposPagina: null as null | ((n: number) => Promise<void>),
  atrasoMs: 0,
}));

vi.mock("@/lib/offline-sync/actions", async () => {
  const { validarEntradaPagina } = await import("@/lib/offline-sync/validar-pagina");
  const { instanteAtualDoBanco, lerPaginaCatalogo } = await import("@/services/catalogo-sync.service");
  return {
    buscarPaginaCatalogoAction: async (entrada: unknown) => {
      const v = validarEntradaPagina(entrada);
      ctl.chamadas.push({ entidade: v.entidade, desde: v.desde, ate: v.ate, apos: v.apos });
      const n = ctl.chamadas.length;
      if (ctl.falharNaChamada === n) throw new Error("Failed to fetch");
      if (ctl.atrasoMs) await new Promise((r) => setTimeout(r, ctl.atrasoMs));
      const ate = v.ate ?? (await instanteAtualDoBanco());
      const { itens, proximo } = await lerPaginaCatalogo(v.entidade, { desde: v.desde, ate, apos: v.apos }, v.tamanho);
      if (ctl.aposPagina) await ctl.aposPagina(n);
      return { ate, itens, proximo };
    },
    buscarCredenciaisPinOfflineAction: async () => ({ ok: true, credenciais: [] }),
  };
});

import { prisma } from "@/services/prisma/client";
import { getOfflineDB } from "../db";
import { obterConfiguracao, definirConfiguracao } from "../configuracao-local.service";
import { sincronizarCatalogo } from "../sincronizacao-catalogo.service";
import { lerPaginaCatalogo } from "@/services/catalogo-sync.service";

const CARIMBO = "ultima_sincronizacao_catalogo";
const PROGRESSO = "progresso_sincronizacao_catalogo";
const VERSAO = "versao_sincronizacao_catalogo";

let categoria = "";
let funcionario = "";

async function limparServidor() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "movimentacoes_estoque", "itens_venda", "vendas", "produtos", "clientes", "categorias", "funcionarios" RESTART IDENTITY CASCADE'
  );
}

async function limparAparelho() {
  const db = getOfflineDB();
  await Promise.all([
    db.produtos_local.clear(),
    db.categorias_local.clear(),
    db.estoque_local.clear(),
    db.funcionarios_local.clear(),
    db.clientes_local.clear(),
    db.configuracoes_local.clear(),
    db.eventos_sincronizacao.clear(),
  ]);
}

/** Insere N produtos num único comando: todos recebem o MESMO updated_at (empate total de timestamps). */
async function criarProdutos(n: number, prefixo = "Produto") {
  await prisma.$executeRawUnsafe(
    `INSERT INTO produtos (nome, categoria_id, preco_venda) SELECT '${prefixo} ' || g, '${categoria}'::uuid, 5 FROM generate_series(1, ${n}) g`
  );
}
async function criarClientes(n: number) {
  await prisma.$executeRawUnsafe(`INSERT INTO clientes (nome) SELECT 'Cliente ' || g FROM generate_series(1, ${n}) g`);
}
async function darEntradaEmTodos(quantidade = 10) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, funcionario_id) SELECT id, 'entrada', ${quantidade}, '${funcionario}'::uuid FROM produtos`
  );
}

const idsLocais = async (tabela: "produtos_local" | "clientes_local") =>
  (await getOfflineDB()[tabela].toArray()).map((x) => x.id).sort();
const idsServidor = async (tabela: "produto" | "cliente") =>
  ((await (prisma[tabela] as unknown as { findMany: (a: object) => Promise<{ id: string }[]> }).findMany({ select: { id: true } })).map((x) => x.id)).sort();

beforeEach(async () => {
  ctl.chamadas = [];
  ctl.falharNaChamada = null;
  ctl.aposPagina = null;
  ctl.atrasoMs = 0;
  await limparServidor();
  await limparAparelho();
  categoria = (await prisma.categoria.create({ data: { nome: "Geral" } })).id;
  funcionario = (await prisma.funcionario.create({ data: { nome: "Caixa", cargo: "gerente", pin_hash: "x" } })).id;
});

afterAll(async () => {
  await limparServidor();
  await prisma.$disconnect();
});

describe("sincronização completa (nenhum registro perdido por limite)", () => {
  it("1. catálogo de 648 produtos: todos chegam ao aparelho, o cursor avança e não sobra progresso", async () => {
    await criarProdutos(648);
    const r = await sincronizarCatalogo();
    expect(r.sucesso).toBe(true);
    expect(r.contagem?.produtos).toBe(648);
    expect(await idsLocais("produtos_local")).toEqual(await idsServidor("produto"));
    expect(await obterConfiguracao(CARIMBO)).toBeTruthy();
    expect(await obterConfiguracao(PROGRESSO)).toBeUndefined();
    expect(await obterConfiguracao(VERSAO)).toBe("2");
  });

  it("2. mais de 1.000 produtos", async () => {
    await criarProdutos(1201);
    const r = await sincronizarCatalogo();
    expect(r.sucesso).toBe(true);
    expect(await getOfflineDB().produtos_local.count()).toBe(1201);
    expect(r.contagem?.produtos).toBe(1201); // nenhuma página repetida
  });

  it("3. mais de 3.000 produtos", async () => {
    await criarProdutos(3001);
    const r = await sincronizarCatalogo();
    expect(r.sucesso).toBe(true);
    expect(await idsLocais("produtos_local")).toEqual(await idsServidor("produto"));
    expect(r.contagem?.produtos).toBe(3001);
    // nenhuma resposta traz o catálogo inteiro: no máximo 500 por página
    expect(ctl.chamadas.filter((c) => c.entidade === "produtos").length).toBe(7);
  });

  it("4. mais de 500 clientes", async () => {
    await criarClientes(620);
    const r = await sincronizarCatalogo();
    expect(r.sucesso).toBe(true);
    expect(await idsLocais("clientes_local")).toEqual(await idsServidor("cliente"));
    expect(r.contagem?.clientes).toBe(620);
  });

  it("5. mais de 1.000 registros de estoque (com saldo correto)", async () => {
    await criarProdutos(1150);
    await darEntradaEmTodos(7);
    const r = await sincronizarCatalogo();
    expect(r.sucesso).toBe(true);
    const db = getOfflineDB();
    expect(await db.estoque_local.count()).toBe(1150);
    expect(r.contagem?.estoque).toBe(1150);
    expect((await db.estoque_local.toArray()).every((e) => e.quantidade_atual === 7)).toBe(true);
  });

  it("6. timestamps iguais: 700 linhas com o MESMO updated_at, páginas pequenas, sem pular nem repetir", async () => {
    await criarProdutos(700);
    const distintos = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT updated_at) AS n FROM produtos`;
    expect(Number(distintos[0].n)).toBe(1); // o cenário de empate realmente existe
    const ate = new Date(Date.now() + 60_000).toISOString();
    let apos: { t: string | null; id: string } | null = null;
    const vistos: string[] = [];
    for (let i = 0; i < 200; i++) {
      const pg: Awaited<ReturnType<typeof lerPaginaCatalogo<"produtos">>> = await lerPaginaCatalogo("produtos", { desde: null, ate, apos }, 7);
      vistos.push(...pg.itens.map((p) => p.id));
      if (!pg.proximo) break;
      apos = pg.proximo;
    }
    expect(vistos).toHaveLength(700);
    expect(new Set(vistos).size).toBe(700);
    expect([...vistos].sort()).toEqual(await idsServidor("produto"));
  });
});

describe("mudanças durante a sincronização", () => {
  it("7. inclusão e alteração DURANTE a paginação: nada se perde (entram na rodada seguinte)", async () => {
    await criarProdutos(1200);
    const alvo = (await prisma.produto.findFirstOrThrow({ orderBy: { id: "asc" } })).id;
    let feito = false;
    ctl.aposPagina = async () => {
      if (feito) return;
      feito = true;
      await prisma.$executeRawUnsafe(
        `INSERT INTO produtos (nome, categoria_id, preco_venda) SELECT 'Novo ' || g, '${categoria}'::uuid, 9 FROM generate_series(1, 5) g`
      );
      await prisma.produto.update({ where: { id: alvo }, data: { nome: "Renomeado durante" } });
    };
    const r1 = await sincronizarCatalogo();
    expect(r1.sucesso).toBe(true);
    const novos = await prisma.produto.count({ where: { nome: { startsWith: "Novo " } } });
    expect(novos).toBe(5);

    ctl.aposPagina = null;
    const r2 = await sincronizarCatalogo();
    expect(r2.sucesso).toBe(true);
    expect(await idsLocais("produtos_local")).toEqual(await idsServidor("produto"));
    expect((await getOfflineDB().produtos_local.get(alvo))?.nome).toBe("Renomeado durante");
  });

  it("registro gravado com data ANTERIOR ao cursor (transação lenta) é recuperado pela sobreposição", async () => {
    await criarProdutos(10);
    await sincronizarCatalogo();
    const cursor = (await obterConfiguracao(CARIMBO)) as string;
    const atrasado = (await prisma.produto.create({ data: { nome: "Atrasado", categoria_id: categoria, preco_venda: 3 } })).id;
    await prisma.$executeRawUnsafe(
      `UPDATE produtos SET updated_at = '${new Date(Date.parse(cursor) - 60_000).toISOString()}' WHERE id = '${atrasado}'::uuid`
    );
    await sincronizarCatalogo();
    expect(await getOfflineDB().produtos_local.get(atrasado)).toBeTruthy();
  });

  it("11. produto já sincronizado e alterado: a alteração chega na rodada seguinte", async () => {
    await criarProdutos(20);
    await sincronizarCatalogo();
    const p = await prisma.produto.findFirstOrThrow();
    await prisma.produto.update({ where: { id: p.id }, data: { nome: "Nome novo", preco_venda: 12.5 } });
    await sincronizarCatalogo();
    const local = await getOfflineDB().produtos_local.get(p.id);
    expect(local?.nome).toBe("Nome novo");
    expect(local?.preco_venda).toBe(12.5);
    expect(await getOfflineDB().produtos_local.count()).toBe(20);
  });

  it("12. exclusão lógica: produto some do PDV (inativo) sem apagar dados locais", async () => {
    await criarProdutos(30);
    await darEntradaEmTodos(4);
    await sincronizarCatalogo();
    const p = await prisma.produto.findFirstOrThrow();
    await prisma.produto.update({ where: { id: p.id }, data: { deleted_at: new Date() } });
    const r = await sincronizarCatalogo();
    expect(r.sucesso).toBe(true);
    expect((await getOfflineDB().produtos_local.get(p.id))?.ativo).toBe(false);
    expect(await getOfflineDB().produtos_local.count()).toBe(30); // nada apagado
  });

  it("estoque: movimentação posterior atualiza só o saldo do produto movimentado", async () => {
    await criarProdutos(5);
    await darEntradaEmTodos(10);
    await sincronizarCatalogo();
    const p = await prisma.produto.findFirstOrThrow();
    await prisma.movimentacaoEstoque.create({
      data: { produto_id: p.id, tipo: "entrada", quantidade: 5, funcionario_id: funcionario },
    });
    ctl.chamadas = [];
    await sincronizarCatalogo();
    expect((await getOfflineDB().estoque_local.get(p.id))?.quantidade_atual).toBe(15);
  });
});

describe("falhas, retomada e repetição", () => {
  it("8/15. internet cai no meio: falha limpa, progresso salvo, cursor global NÃO avança", async () => {
    await criarProdutos(1300);
    ctl.falharNaChamada = 4; // 1 categorias + 3 produtos (500,500,300): cai na 4ª chamada
    const r = await sincronizarCatalogo();
    expect(r.sucesso).toBe(false);
    expect(r.erro).toMatch(/Failed to fetch/);
    expect(await obterConfiguracao(CARIMBO)).toBeUndefined(); // sem avanço prematuro
    expect(await obterConfiguracao(PROGRESSO)).toBeTruthy(); // retomável
    expect(await getOfflineDB().produtos_local.count()).toBe(1000); // o que já chegou foi mantido
  });

  it("9. retoma de onde parou: sem repetir páginas já gravadas, sem perda nem duplicação", async () => {
    await criarProdutos(1300);
    ctl.falharNaChamada = 4;
    await sincronizarCatalogo();
    const ateSalvo = JSON.parse((await obterConfiguracao(PROGRESSO)) as string).ate;

    ctl.chamadas = [];
    ctl.falharNaChamada = null;
    const r = await sincronizarCatalogo();
    expect(r.sucesso).toBe(true);
    // a 1ª chamada da retomada já traz o cursor da página seguinte (não recomeça) e reaproveita a mesma janela
    expect(ctl.chamadas[0].entidade).toBe("produtos");
    expect(ctl.chamadas[0].apos).not.toBeNull();
    expect(ctl.chamadas.every((c) => c.ate === ateSalvo)).toBe(true);
    expect(await idsLocais("produtos_local")).toEqual(await idsServidor("produto"));
    expect(await obterConfiguracao(CARIMBO)).toBe(ateSalvo);
    expect(await obterConfiguracao(PROGRESSO)).toBeUndefined();
  });

  it("retomada também depois de falha em outra entidade (estoque), preservando as já concluídas", async () => {
    await criarProdutos(600);
    await criarClientes(700);
    await darEntradaEmTodos(3);
    // chamadas: 1 categorias, 2 produtos(500), 3 produtos(100), 4 estoque(500) -> cai na 5ª (estoque, 2ª página)
    ctl.falharNaChamada = 5;
    expect((await sincronizarCatalogo()).sucesso).toBe(false);
    ctl.chamadas = [];
    ctl.falharNaChamada = null;
    const r = await sincronizarCatalogo();
    expect(r.sucesso).toBe(true);
    expect(ctl.chamadas.some((c) => c.entidade === "categorias" || c.entidade === "produtos")).toBe(false);
    expect(await getOfflineDB().estoque_local.count()).toBe(600);
    expect(await getOfflineDB().clientes_local.count()).toBe(700);
  });

  it("10. repetir a mesma sincronização é idempotente (sem duplicar, sem perder)", async () => {
    await criarProdutos(700);
    await criarClientes(520);
    await darEntradaEmTodos(2);
    await sincronizarCatalogo();
    const antes = { p: await idsLocais("produtos_local"), c: await idsLocais("clientes_local"), e: await getOfflineDB().estoque_local.count() };
    await sincronizarCatalogo();
    await sincronizarCatalogo();
    expect(await idsLocais("produtos_local")).toEqual(antes.p);
    expect(await idsLocais("clientes_local")).toEqual(antes.c);
    expect(await getOfflineDB().estoque_local.count()).toBe(antes.e);
  });

  it("progresso ilegível não trava: recomeça a rodada", async () => {
    await criarProdutos(30);
    await definirConfiguracao(PROGRESSO, "{lixo");
    const r = await sincronizarCatalogo();
    expect(r.sucesso).toBe(true);
    expect(await getOfflineDB().produtos_local.count()).toBe(30);
  });
});

describe("concorrência", () => {
  it("13. duas sincronizações simultâneas não se misturam e o resultado é consistente", async () => {
    await criarProdutos(1100);
    ctl.atrasoMs = 3;
    const [a, b] = await Promise.all([sincronizarCatalogo(), sincronizarCatalogo()]);
    expect(a.sucesso && b.sucesso).toBe(true);
    expect(await idsLocais("produtos_local")).toEqual(await idsServidor("produto"));
    // rodadas em série: todas as chamadas da 1ª rodada vêm antes de qualquer chamada da 2ª
    const rodadas = [...new Set(ctl.chamadas.map((c) => c.ate ?? "primeira"))];
    const ultimaDaPrimeira = ctl.chamadas.map((c) => c.desde).lastIndexOf(null);
    const primeiraDaSegunda = ctl.chamadas.findIndex((c) => c.desde !== null);
    expect(rodadas.length).toBeGreaterThanOrEqual(2);
    expect(primeiraDaSegunda).toBeGreaterThan(ultimaDaPrimeira);
    expect(await obterConfiguracao(PROGRESSO)).toBeUndefined();
  });

  it("entre abas usa Web Locks quando disponível", async () => {
    await criarProdutos(5);
    const request = vi.fn((_nome: string, fn: () => Promise<unknown>) => fn());
    vi.stubGlobal("navigator", { locks: { request } });
    try {
      expect((await sincronizarCatalogo()).sucesso).toBe(true);
      expect(request).toHaveBeenCalledWith("sincronizacao-catalogo", expect.any(Function));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("compatibilidade com aparelhos que já têm cursor", () => {
  it("14. cursor ANTIGO (protocolo sem versão, de uma leitura truncada em 500): refaz uma sincronização completa e recupera o que faltava", async () => {
    await criarProdutos(648);
    // estado de um aparelho do protocolo antigo: só os 500 primeiros e um cursor "de agora"
    const db = getOfflineDB();
    const primeiros = await prisma.produto.findMany({ orderBy: { updated_at: "asc" }, take: 500 });
    await db.produtos_local.bulkPut(
      primeiros.map((p) => ({ id: p.id, nome: p.nome, preco_venda: 5, codigo_barras: null, categoria_id: p.categoria_id, ativo: true, updated_at: p.updated_at.toISOString() }))
    );
    await definirConfiguracao(CARIMBO, new Date().toISOString());
    expect(await db.produtos_local.count()).toBe(500);

    const r = await sincronizarCatalogo();
    expect(r.sucesso).toBe(true);
    expect(ctl.chamadas[0].desde).toBeNull(); // completa, não incremental
    expect(await idsLocais("produtos_local")).toEqual(await idsServidor("produto"));
    expect(await obterConfiguracao(VERSAO)).toBe("2");
  });

  it("depois da migração do aparelho, as rodadas seguintes são incrementais (com sobreposição)", async () => {
    await criarProdutos(40);
    await sincronizarCatalogo();
    const cursor = (await obterConfiguracao(CARIMBO)) as string;
    ctl.chamadas = [];
    await sincronizarCatalogo();
    const desde = ctl.chamadas[0].desde as string;
    expect(desde).not.toBeNull();
    expect(Date.parse(cursor) - Date.parse(desde)).toBe(5 * 60 * 1000);
  });

  it("dados locais válidos nunca são apagados por uma sincronização (dado local fora do servidor permanece)", async () => {
    await criarProdutos(10);
    await getOfflineDB().produtos_local.put({ id: "local-1", nome: "Só local", preco_venda: 1, codigo_barras: null, categoria_id: categoria, ativo: true, updated_at: new Date().toISOString() });
    await sincronizarCatalogo();
    expect(await getOfflineDB().produtos_local.get("local-1")).toBeTruthy();
  });
});
