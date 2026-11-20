// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * SEC-01 — horário confiável da venda, contra PostgreSQL REAL de teste (npm run test:integracao).
 *
 *   created_at  = quando o SERVIDOR gravou (nunca vem do aparelho)
 *   ocorrido_em = quando a venda aconteceu segundo o aparelho, VALIDADO (janela de 48 h, não anterior à abertura
 *                 do caixa, no máximo 5 min no futuro). Fora disso a venda fica retida em vendas_revisao: nada de
 *                 venda confirmada, estoque, lançamento de caixa ou conta a receber até um administrador decidir.
 *
 * Os instantes são relativos ao relógio real porque a janela de 48 h é relativa a "agora".
 */
process.env.TZ = "UTC";

import { prisma } from "@/services/prisma/client";
import { criarUsuarioDeTeste } from "../../auth/__tests__/fixtures-usuarios";
import { abrirCaixa, fecharCaixa, resumoDoCaixa, type Autoria } from "@/services/caixa.service";
import { aprovarVendaEmRevisao, processarVendaRecebida, rejeitarVendaEmRevisao } from "@/services/vendas-sincronizadas.service";
import { buscarVendaCompleta } from "@/services/vendas.service";
import { buscarResumoDashboard } from "@/services/dashboard.service";
import { listarVendasDetalhadas } from "@/services/relatorios.service";
import { lerFiltroVendas } from "@/lib/relatorios/filtro";
import { diaLocal, hojeLocal } from "@/lib/utils/fuso";
import type { VendaRecebida } from "@/lib/vendas/validacao-sincronizacao";

const H = 3600_000;
const MIN = 60_000;
const TERMINAL = "terminal-A";
const ids = { produto: "", ana: "", usuario: "", admin: "", cliente: "" };

async function limparTudo() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "autorizacoes_caixa", "auditoria_caixa", "movimentos_caixa", "caixa_conflitos", "caixas", "vendas_revisao", "recebimentos", "contas_receber", "movimentacoes_estoque", "itens_venda", "vendas", "produtos", "categorias", "funcionarios", "clientes", "sessoes", "tokens_recuperacao", "limites_tentativa", "usuarios", "tentativas_pin" RESTART IDENTITY CASCADE'
  );
}

const quando = (deslocamentoMs: number) => new Date(Date.now() + deslocamentoMs).toISOString();
const autoria = (): Autoria => ({ funcionario_id: ids.ana, usuario_id: null, dispositivo: TERMINAL, origem: "online" });

async function abrir(abertoHaMs: number) {
  const id = randomUUID();
  const r = await abrirCaixa({ id, terminal_id: TERMINAL, terminal_papel: "principal", fundo_inicial_centavos: 10000, aberto_em: quando(-abertoHaMs) }, autoria());
  expect(r.status).toBe("ok");
  return id;
}

function payload(caixa: string, criado_em: string | undefined, extras: Partial<VendaRecebida> = {}): VendaRecebida {
  return {
    funcionario_id: ids.ana,
    forma_pagamento: "dinheiro",
    total: 20,
    caixa_id: caixa,
    dispositivo: TERMINAL,
    terminal: TERMINAL,
    criado_em,
    origem: "offline",
    itens: [{ produto_id: ids.produto, quantidade: 2, preco_unitario: 10 }],
    ...extras,
  };
}

/** Tudo o que uma venda confirmada deixaria no banco. */
async function efeitos(vendaId: string) {
  const [vendas, itens, estoque, movimentos, contas, revisoes] = await Promise.all([
    prisma.venda.count({ where: { id: vendaId } }),
    prisma.itemVenda.count({ where: { venda_id: vendaId } }),
    prisma.movimentacaoEstoque.count({ where: { venda_id: vendaId } }),
    prisma.movimentoCaixa.count({ where: { venda_id: vendaId } }),
    prisma.contaReceber.count({ where: { venda_id: vendaId } }),
    prisma.vendaRevisao.count({ where: { id: vendaId } }),
  ]);
  return { vendas, itens, estoque, movimentos, contas, revisoes };
}
const NADA = { vendas: 0, itens: 0, estoque: 0, movimentos: 0, contas: 0 };

beforeEach(async () => {
  await limparTudo();
  const categoria = await prisma.categoria.create({ data: { nome: "Bebidas" } });
  ids.produto = (await prisma.produto.create({ data: { nome: "Água 500ml", categoria_id: categoria.id, preco_venda: 10, preco_custo: 4 } })).id;
  ids.ana = (await prisma.funcionario.create({ data: { nome: "Ana", cargo: "frentista", pin_hash: "x" } })).id;
  ids.cliente = (await prisma.cliente.create({ data: { nome: "Cliente Fiado" } })).id;
  ids.usuario = (await criarUsuarioDeTeste({ nome: "Operador", email: "op@loja.com", senha: "Cafe-com-Leite-42", papel: "operador" })).id;
  ids.admin = (await criarUsuarioDeTeste({ nome: "Admin", email: "admin@loja.com", senha: "Cafe-com-Leite-42", papel: "admin" })).id;
  await prisma.movimentacaoEstoque.create({ data: { produto_id: ids.produto, tipo: "entrada", quantidade: 1000, funcionario_id: ids.ana } });
});

afterAll(async () => {
  await limparTudo();
  await prisma.$disconnect();
});

describe("created_at é do servidor; ocorrido_em é do aparelho", () => {
  it("1. venda ONLINE: grava ocorrido_em com o horário do aparelho e created_at com o do servidor", async () => {
    const caixa = await abrir(2 * H);
    const id = randomUUID();
    const informado = quando(-3000);
    const antes = Date.now();
    expect(await processarVendaRecebida(id, payload(caixa, informado, { origem: "online" }), ids.usuario)).toEqual({ status: "registrada", jaExistia: false });
    const v = await prisma.venda.findUniqueOrThrow({ where: { id } });
    expect(v.ocorrido_em!.toISOString()).toBe(informado);
    expect(v.created_at.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(v.created_at.toISOString()).not.toBe(informado);
  });

  it("2. venda OFFLINE sincronizada dentro de 48 h: aceita; ocorrido_em é o do aparelho, created_at é a chegada", async () => {
    const caixa = await abrir(50 * H);
    const id = randomUUID();
    const informado = quando(-47 * H);
    expect(await processarVendaRecebida(id, payload(caixa, informado), ids.usuario)).toMatchObject({ status: "registrada" });
    const v = await prisma.venda.findUniqueOrThrow({ where: { id } });
    expect(v.ocorrido_em!.toISOString()).toBe(informado);
    expect(Math.abs(v.created_at.getTime() - Date.now())).toBeLessThan(60_000);
    expect(await efeitos(id)).toMatchObject({ vendas: 1, itens: 1, estoque: 1, movimentos: 1 });
    const mov = await prisma.movimentoCaixa.findFirstOrThrow({ where: { venda_id: id } });
    expect(mov.ocorrido_em.toISOString()).toBe(informado);
  });

  it("3. venda offline com MAIS de 48 h: retida; nada confirmado; conteúdo e horário originais preservados", async () => {
    const caixa = await abrir(100 * H);
    const id = randomUUID();
    const informado = quando(-49 * H);
    const r = await processarVendaRecebida(id, payload(caixa, informado, { cliente_id: ids.cliente, forma_pagamento: "fiado" }), ids.usuario);
    expect(r).toMatchObject({ status: "em_revisao", bloqueante: false });
    expect(JSON.stringify(r)).toMatch(/48 horas/);

    expect(await efeitos(id)).toEqual({ ...NADA, revisoes: 1 }); // sem venda, estoque, lançamento de caixa nem conta a receber
    expect(await prisma.contaReceber.count()).toBe(0);
    const rev = await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } });
    expect(rev.status).toBe("pendente");
    expect(rev.payload).toMatchObject({ criado_em: informado, dispositivo: TERMINAL, terminal: TERMINAL, caixa_id: caixa, origem: "offline", funcionario_id: ids.ana });
    expect((rev.payload as { itens: unknown[] }).itens).toHaveLength(1);
    expect(JSON.stringify(rev.motivos)).toContain("fora_janela_offline");
  });

  it("4. evento ANTERIOR À ABERTURA do caixa (mesmo dentro de 48 h): retido", async () => {
    const caixa = await abrir(2 * H);
    const id = randomUUID();
    const r = await processarVendaRecebida(id, payload(caixa, quando(-3 * H)), ids.usuario);
    expect(r).toMatchObject({ status: "em_revisao" });
    expect(JSON.stringify(r)).toContain("anterior_abertura_caixa");
    expect(await efeitos(id)).toEqual({ ...NADA, revisoes: 1 });
  });

  it("5. relógio ADIANTADO: +4 min passa (tolerância); +10 min e +3 h ficam retidos, sem virar 'agora'", async () => {
    const caixa = await abrir(2 * H);
    const ok = randomUUID();
    expect(await processarVendaRecebida(ok, payload(caixa, quando(4 * MIN)), ids.usuario)).toMatchObject({ status: "registrada" });

    for (const adiantamento of [10 * MIN, 3 * H]) {
      const id = randomUUID();
      const informado = quando(adiantamento);
      expect(await processarVendaRecebida(id, payload(caixa, informado), ids.usuario)).toMatchObject({ status: "em_revisao" });
      expect(await efeitos(id)).toEqual({ ...NADA, revisoes: 1 });
      expect((await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } })).payload).toMatchObject({ criado_em: informado });
    }
  });

  it("6. relógio ATRASADO: 30 min atrás (depois da abertura) passa com o horário informado; 5 dias atrás fica retido", async () => {
    const caixa = await abrir(10 * H);
    const leve = randomUUID();
    const informado = quando(-30 * MIN);
    expect(await processarVendaRecebida(leve, payload(caixa, informado), ids.usuario)).toMatchObject({ status: "registrada" });
    expect((await prisma.venda.findUniqueOrThrow({ where: { id: leve } })).ocorrido_em!.toISOString()).toBe(informado);

    const muito = randomUUID();
    expect(await processarVendaRecebida(muito, payload(caixa, quando(-5 * 24 * H)), ids.usuario)).toMatchObject({ status: "em_revisao" });
    expect((await efeitos(muito)).vendas).toBe(0);
  });

  it("horário ilegível: retido para revisão (nunca gravado como 'agora')", async () => {
    const caixa = await abrir(2 * H);
    const id = randomUUID();
    expect(await processarVendaRecebida(id, payload(caixa, "ontem à noite"), ids.usuario)).toMatchObject({ status: "em_revisao" });
    expect(await efeitos(id)).toEqual({ ...NADA, revisoes: 1 });
  });
});

describe("reenvio, concorrência e revisão", () => {
  it("7. reenvio do MESMO evento: venda válida não duplica venda, pagamento nem baixa de estoque", async () => {
    const caixa = await abrir(2 * H);
    const id = randomUUID();
    const p = payload(caixa, quando(-60_000));
    expect(await processarVendaRecebida(id, p, ids.usuario)).toEqual({ status: "registrada", jaExistia: false });
    for (let i = 0; i < 3; i++) expect(await processarVendaRecebida(id, p, ids.usuario)).toEqual({ status: "registrada", jaExistia: true });
    expect(await efeitos(id)).toMatchObject({ vendas: 1, itens: 1, estoque: 1, movimentos: 1 });
  });

  it("7b. reenvio do MESMO evento retido: continua retido, um único registro de revisão, nada confirmado", async () => {
    const caixa = await abrir(100 * H);
    const id = randomUUID();
    const p = payload(caixa, quando(-60 * H));
    for (let i = 0; i < 4; i++) expect(await processarVendaRecebida(id, p, ids.usuario)).toMatchObject({ status: "em_revisao" });
    expect(await efeitos(id)).toEqual({ ...NADA, revisoes: 1 });
  });

  it("8. duas (ou mais) tentativas SIMULTÂNEAS: uma venda, um lançamento, uma baixa de estoque", async () => {
    const caixa = await abrir(2 * H);
    const id = randomUUID();
    const p = payload(caixa, quando(-60_000));
    const rs = await Promise.all(Array.from({ length: 8 }, () => processarVendaRecebida(id, p, ids.usuario)));
    expect(rs.every((r) => r.status === "registrada")).toBe(true);
    expect(rs.filter((r) => r.status === "registrada" && !r.jaExistia)).toHaveLength(1);
    expect(await efeitos(id)).toMatchObject({ vendas: 1, itens: 1, estoque: 1, movimentos: 1 });
    expect((await resumoDoCaixa(caixa))!.quantidade_vendas).toBe(1);
  });

  it("8b. tentativas simultâneas do evento retido: um único registro de revisão", async () => {
    const caixa = await abrir(100 * H);
    const id = randomUUID();
    const p = payload(caixa, quando(-60 * H));
    const rs = await Promise.all(Array.from({ length: 8 }, () => processarVendaRecebida(id, p, ids.usuario)));
    expect(rs.every((r) => r.status === "em_revisao")).toBe(true);
    expect(await efeitos(id)).toEqual({ ...NADA, revisoes: 1 });
  });

  it("9. retida e depois RESOLVIDA pelo administrador: grava uma vez, com os horários certos; nova tentativa não duplica", async () => {
    const caixa = await abrir(100 * H);
    const id = randomUUID();
    const informado = quando(-60 * H);
    await processarVendaRecebida(id, payload(caixa, informado), ids.usuario);
    expect(await efeitos(id)).toEqual({ ...NADA, revisoes: 1 });

    expect(await aprovarVendaEmRevisao(id, ids.admin, "Conferido com o gerente")).toEqual({ ok: true });
    expect(await efeitos(id)).toMatchObject({ vendas: 1, itens: 1, estoque: 1, movimentos: 1, revisoes: 1 });
    const v = await prisma.venda.findUniqueOrThrow({ where: { id } });
    expect(v.ocorrido_em!.toISOString()).toBe(informado); // o horário que o administrador viu e aprovou
    expect(Math.abs(v.created_at.getTime() - Date.now())).toBeLessThan(60_000); // o recebimento NÃO é reescrito
    expect((await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } })).status).toBe("aprovada");

    // segunda aprovação e reenvio pelo aparelho: nada duplica
    expect((await aprovarVendaEmRevisao(id, ids.admin)).ok).toBe(false);
    expect(await processarVendaRecebida(id, payload(caixa, informado), ids.usuario)).toEqual({ status: "registrada", jaExistia: true });
    expect(await efeitos(id)).toMatchObject({ vendas: 1, itens: 1, estoque: 1, movimentos: 1 });
  });

  it("9b. retida e REJEITADA: continua sem venda/estoque/caixa e o reenvio informa a rejeição", async () => {
    const caixa = await abrir(100 * H);
    const id = randomUUID();
    const p = payload(caixa, quando(-60 * H));
    await processarVendaRecebida(id, p, ids.usuario);
    expect(await rejeitarVendaEmRevisao(id, ids.admin, "Venda fora de época")).toEqual({ ok: true });
    expect(await processarVendaRecebida(id, p, ids.usuario)).toMatchObject({ status: "rejeitada", observacao: "Venda fora de época" });
    expect(await efeitos(id)).toEqual({ ...NADA, revisoes: 1 });
  });
});

describe("relatórios, histórico, dashboard e recibo usam ocorrido_em; vendas antigas usam created_at", () => {
  it("11. relatório por data usa ocorrido_em: venda de ontem recebida hoje aparece em ontem, não em hoje", async () => {
    const caixa = await abrir(60 * H);
    const id = randomUUID();
    const informado = quando(-30 * H);
    await processarVendaRecebida(id, payload(caixa, informado), ids.usuario);

    const diaDaVenda = diaLocal(new Date(informado));
    expect(diaDaVenda).not.toBe(hojeLocal());
    const f = (de: string) => lerFiltroVendas({ de, ate: de }, new Date()).filtro;
    expect((await listarVendasDetalhadas(f(diaDaVenda))).vendas.map((v) => v.id)).toEqual([id]);
    expect((await listarVendasDetalhadas(f(hojeLocal()))).vendas).toEqual([]);
    const [venda] = (await listarVendasDetalhadas(f(diaDaVenda))).vendas;
    expect(venda.created_at).toBe(informado); // o relatório mostra quando a venda aconteceu

    // dashboard "hoje": a venda de ontem, mesmo recebida hoje, não entra
    expect((await buscarResumoDashboard()).quantidadeVendasHoje).toBe(0);
  });

  it("11b. dashboard 'hoje' conta a venda que ocorreu hoje", async () => {
    const caixa = await abrir(2 * H);
    await processarVendaRecebida(randomUUID(), payload(caixa, quando(-60_000)), ids.usuario);
    const r = await buscarResumoDashboard();
    expect(r).toMatchObject({ quantidadeVendasHoje: 1, faturamentoHoje: 20 });
  });

  it("12. registro HISTÓRICO sem ocorrido_em continua usando created_at (e não é modificado)", async () => {
    const id = randomUUID();
    await prisma.venda.create({ data: { id, funcionario_id: ids.ana, forma_pagamento: "dinheiro", total: 30, created_at: new Date("2026-03-10T21:44:11.000Z") } });
    await prisma.itemVenda.create({ data: { venda_id: id, produto_id: ids.produto, quantidade: 3, preco_unitario: 10 } });

    const filtro = lerFiltroVendas({ de: "2026-03-10" }, new Date("2026-03-12T12:00:00Z")).filtro;
    const r = await listarVendasDetalhadas(filtro);
    expect(r.vendas.map((v) => v.id)).toEqual([id]);
    expect(r.vendas[0].created_at).toBe("2026-03-10T21:44:11.000Z");
    const recibo = (await buscarVendaCompleta(id))!;
    expect(recibo.created_at).toBe("2026-03-10T21:44:11.000Z");
    expect((await prisma.venda.findUniqueOrThrow({ where: { id } })).ocorrido_em).toBeNull(); // nada reinterpretado
  });

  it("recibo: mostra o horário da OCORRÊNCIA e guarda à parte o do recebimento no servidor", async () => {
    const caixa = await abrir(60 * H);
    const id = randomUUID();
    const informado = quando(-30 * H);
    await processarVendaRecebida(id, payload(caixa, informado), ids.usuario);
    const recibo = (await buscarVendaCompleta(id))!;
    expect(recibo.created_at).toBe(informado);
    expect(Math.abs(new Date(recibo.recebido_em!).getTime() - Date.now())).toBeLessThan(60_000);
  });
});

describe("fechamento de caixa", () => {
  it("13. depois de sincronizações válidas o fechamento soma só o que foi confirmado; a retida não entra", async () => {
    const caixa = await abrir(60 * H);
    const valida = randomUUID();
    const retida = randomUUID();
    await processarVendaRecebida(valida, payload(caixa, quando(-20 * H)), ids.usuario);
    await processarVendaRecebida(retida, payload(caixa, quando(-70 * H)), ids.usuario);

    const resumo = (await resumoDoCaixa(caixa))!;
    expect(resumo.quantidade_vendas).toBe(1);
    expect(resumo.dinheiro.saldo_esperado_centavos).toBe(10000 + 2000);

    const r = await fecharCaixa({ caixa_id: caixa, fechado_em: quando(-1000), conferencia: { dinheiro_centavos: 12000 } }, autoria());
    expect(r.status).toBe("ok");
    const c = await prisma.caixa.findUniqueOrThrow({ where: { id: caixa } });
    expect(c.status).toBe("fechado");
    expect(c.diferenca_dinheiro_centavos).toBe(0);
    expect(await efeitos(retida)).toEqual({ ...NADA, revisoes: 1 });
  });
});
