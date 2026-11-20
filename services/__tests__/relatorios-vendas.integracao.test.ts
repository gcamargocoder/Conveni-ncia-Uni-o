// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * Relatórios de vendas contra um PostgreSQL REAL de teste (npm run test:integracao, exige TEST_DATABASE_URL
 * terminado em _test). Prova que a MESMA venda aparece com o MESMO dia e horário no banco, na consulta do
 * relatório, na planilha e no caixa — o defeito original era 18/11 21h44 aparecer como 19/11 00h44.
 *
 * As datas são fixas e passadas (10/03/2026) para o teste não depender do relógio da máquina. O processo roda
 * em UTC de propósito (como o Railway): se algum ponto dependesse do fuso do servidor, o teste falharia.
 */
process.env.TZ = "UTC";

import { prisma } from "@/services/prisma/client";
import { abrirCaixa, fecharCaixa, type Autoria } from "@/services/caixa.service";
import { listarCaixas } from "@/services/caixa-consulta.service";
import { registrarVenda } from "@/services/vendas.service";
import { buscarResumoDashboard } from "@/services/dashboard.service";
import { listarVendasDetalhadas, resumirPagamentos } from "@/services/relatorios.service";
import { lerFiltroVendas } from "@/lib/relatorios/filtro";
import { abaFechamentos, montarPlanilhas, totaisConferencia } from "@/lib/relatorios/planilha-vendas";
import { gerarXlsx } from "@/lib/relatorios/xlsx";
import { formatarData, formatarDataHoraComSegundos, instanteLocal } from "@/lib/utils/fuso";
import { lerAba, lerZip } from "@/lib/relatorios/__tests__/ler-zip";

const TERMINAL_A = "terminal-A";
const TERMINAL_B = "terminal-B";
const ids = { produto: "", ana: "", beto: "" };

async function limparTudo() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "autorizacoes_caixa", "auditoria_caixa", "movimentos_caixa", "caixa_conflitos", "caixas", "vendas_revisao", "recebimentos", "contas_receber", "movimentacoes_estoque", "itens_venda", "vendas", "produtos", "categorias", "funcionarios", "clientes", "sessoes", "tokens_recuperacao", "limites_tentativa", "usuarios", "tentativas_pin" RESTART IDENTITY CASCADE'
  );
}

const autoria = (funcionario: string, terminal: string): Autoria => ({ funcionario_id: funcionario, usuario_id: null, dispositivo: terminal, origem: "online" });
const em = (dia: string, hora: string) => instanteLocal(dia, hora).toISOString();

async function abrir(terminal: string, funcionario: string, abertoEm: string, fundo = 10000) {
  const id = randomUUID();
  const r = await abrirCaixa({ id, terminal_id: terminal, terminal_papel: "principal", fundo_inicial_centavos: fundo, aberto_em: abertoEm }, autoria(funcionario, terminal));
  expect(r.status).toBe("ok");
  return id;
}

async function vender(
  caixa: string,
  terminal: string,
  funcionario: string,
  ocorridoEm: string | null,
  extras: { total?: number; pagamentos?: { forma: "dinheiro" | "pix" | "credito" | "debito" | "fiado"; valor_centavos: number }[]; forma?: "dinheiro" | "pix" } = {}
) {
  const total = extras.total ?? 20;
  const id = randomUUID();
  await registrarVenda({
    id,
    funcionario_id: funcionario,
    forma_pagamento: extras.forma ?? "dinheiro",
    dispositivo: terminal,
    caixa_id: caixa,
    itens: [{ produto_id: ids.produto, nome: "Água", quantidade: total / 10, preco_unitario: 10 }],
    pagamentos: extras.pagamentos,
    ocorrido_em: ocorridoEm,
    origem: ocorridoEm ? "offline" : "online",
  });
  return id;
}

const filtro = (p: Record<string, string>) => lerFiltroVendas(p, new Date("2026-03-12T12:00:00Z")).filtro;

beforeEach(async () => {
  await limparTudo();
  const categoria = await prisma.categoria.create({ data: { nome: "Bebidas" } });
  ids.produto = (await prisma.produto.create({ data: { nome: "Água 500ml", categoria_id: categoria.id, preco_venda: 10, preco_custo: 4 } })).id;
  ids.ana = (await prisma.funcionario.create({ data: { nome: "Ana", cargo: "frentista", pin_hash: "x" } })).id;
  ids.beto = (await prisma.funcionario.create({ data: { nome: "Beto", cargo: "frentista", pin_hash: "x" } })).id;
  await prisma.movimentacaoEstoque.create({ data: { produto_id: ids.produto, tipo: "entrada", quantidade: 1000, funcionario_id: ids.ana } });
});

afterAll(async () => {
  await limparTudo();
  await prisma.$disconnect();
});

describe("a mesma venda, o mesmo horário em todos os lugares (banco em UTC, servidor em UTC)", () => {
  it("venda às 21h44 do dia 10: banco, relatório e planilha dizem 10/03 21:44:11 — nunca 11/03 00:44", async () => {
    const caixa = await abrir(TERMINAL_A, ids.ana, em("2026-03-10", "08:00"));
    const id = await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "21:44:11"));

    // 1) banco: instante real preservado (UTC do dia seguinte), tanto na venda quanto no lançamento do caixa
    //    ocorrido_em = horário do aparelho; created_at = horário em que o SERVIDOR gravou (nunca o do aparelho)
    const linha = await prisma.venda.findUniqueOrThrow({ where: { id } });
    expect(linha.ocorrido_em!.toISOString()).toBe("2026-03-11T00:44:11.000Z");
    expect(Math.abs(linha.created_at.getTime() - Date.now())).toBeLessThan(60_000);
    const mov = await prisma.movimentoCaixa.findFirstOrThrow({ where: { venda_id: id } });
    expect(mov.ocorrido_em.toISOString()).toBe(linha.ocorrido_em!.toISOString());

    // 2) relatório do dia 10 contém a venda; o do dia 11 NÃO
    const doDia10 = await listarVendasDetalhadas(filtro({ de: "2026-03-10" }));
    const doDia11 = await listarVendasDetalhadas(filtro({ de: "2026-03-11" }));
    expect(doDia10.vendas.map((v) => v.id)).toEqual([id]);
    expect(doDia11.vendas).toEqual([]);

    // 3) formatação (a mesma usada pelo relatório, histórico e cupom)
    const v = doDia10.vendas[0];
    expect(formatarDataHoraComSegundos(v.created_at)).toBe("10/03/2026 21:44:11");
    expect(formatarData(v.created_at)).toBe("10/03/2026");

    // 4) planilha
    const xlsx = gerarXlsx(montarPlanilhas({ filtro: filtro({ de: "2026-03-10" }), vendas: doDia10.vendas, caixas: [], geradoEm: new Date(), truncado: false, rotulos: { funcionario: null, terminal: null, turno: null } }));
    const aba = lerAba(lerZip(xlsx).get("xl/worksheets/sheet2.xml")!.toString());
    expect([aba.get("A2")!.texto, aba.get("B2")!.texto]).toEqual(["10/03/2026", "21:44:11"]);
  });

  it("perto da meia-noite: 23:59:59 é do dia 10; 00:00:01 e 00:30 são do dia 11", async () => {
    const caixa = await abrir(TERMINAL_A, ids.ana, em("2026-03-10", "08:00"));
    const antes = await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "23:59:59"));
    const depois = await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-11", "00:00:01"));
    const depois2 = await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-11", "00:30:00"));

    const dia10 = (await listarVendasDetalhadas(filtro({ de: "2026-03-10" }))).vendas.map((v) => v.id);
    const dia11 = (await listarVendasDetalhadas(filtro({ de: "2026-03-11" }))).vendas.map((v) => v.id);
    expect(dia10).toEqual([antes]);
    expect(dia11.sort()).toEqual([depois, depois2].sort());
    const ambos = await listarVendasDetalhadas(filtro({ de: "2026-03-10", ate: "2026-03-11" }));
    expect(ambos.vendas).toHaveLength(3);
  });

  it("venda offline sincronizada no dia seguinte mantém o dia/horário em que ocorreu", async () => {
    const caixa = await abrir(TERMINAL_A, ids.ana, em("2026-03-10", "08:00"));
    // ocorreu 21:10 do dia 10; a "sincronização" é agora (bem depois) — o relatório não pode mudar de dia
    const id = await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "21:10:00"));
    const v = (await listarVendasDetalhadas(filtro({ de: "2026-03-10" }))).vendas.find((x) => x.id === id)!;
    expect(formatarDataHoraComSegundos(v.created_at)).toBe("10/03/2026 21:10:00");
    const gravada = await prisma.venda.findUniqueOrThrow({ where: { id } });
    expect(gravada.ocorrido_em!.getTime()).toBe(instanteLocal("2026-03-10", "21:10:00").getTime());
    expect(gravada.created_at.getTime()).toBeGreaterThan(instanteLocal("2026-03-11", "00:00:00").getTime()); // recebida só depois, no servidor
  });

  it("sem horário do aparelho ou com horário no futuro: ocorrido_em fica vazio (nunca vira 'agora') e created_at é o do servidor", async () => {
    const caixa = await abrir(TERMINAL_A, ids.ana, em("2026-03-10", "08:00"));
    const antes = Date.now();
    const semHora = await vender(caixa, TERMINAL_A, ids.ana, null);
    const futuro = await vender(caixa, TERMINAL_A, ids.ana, new Date(Date.now() + 3 * 3600_000).toISOString());
    const depois = Date.now();
    for (const id of [semHora, futuro]) {
      const v = await prisma.venda.findUniqueOrThrow({ where: { id } });
      expect(v.ocorrido_em).toBeNull();
      expect(v.created_at.getTime()).toBeGreaterThanOrEqual(antes - 1000);
      expect(v.created_at.getTime()).toBeLessThanOrEqual(depois + 1000);
    }
  });
});

describe("filtros combinados", () => {
  it("intervalo de horário 08:00–18:00 do dia 10 devolve só as vendas dentro dele", async () => {
    const caixa = await abrir(TERMINAL_A, ids.ana, em("2026-03-10", "07:00"));
    const ids_ = {
      cedo: await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "07:59:59")),
      abre: await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "08:00:00")),
      meio: await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "12:30:00")),
      fecha: await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "18:00:30")),
      tarde: await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "18:01:00")),
      noite: await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "21:44:11")),
    };
    const r = await listarVendasDetalhadas(filtro({ de: "2026-03-10", ate: "2026-03-10", hi: "08:00", hf: "18:00" }));
    expect(r.vendas.map((v) => v.id).sort()).toEqual([ids_.abre, ids_.meio, ids_.fecha].sort());
  });

  it("funcionário + terminal + turno + forma + situação, todos em conjunto", async () => {
    const cxA = await abrir(TERMINAL_A, ids.ana, em("2026-03-10", "07:00"));
    const cxB = await abrir(TERMINAL_B, ids.beto, em("2026-03-10", "07:00"));
    const anaDinheiro = await vender(cxA, TERMINAL_A, ids.ana, em("2026-03-10", "10:00"));
    const anaPix = await vender(cxA, TERMINAL_A, ids.ana, em("2026-03-10", "11:00"), { forma: "pix" });
    const betoDinheiro = await vender(cxB, TERMINAL_B, ids.beto, em("2026-03-10", "12:00"));
    const cancelada = await vender(cxA, TERMINAL_A, ids.ana, em("2026-03-10", "13:00"));
    await prisma.venda.update({ where: { id: cancelada }, data: { cancelada: true } });

    const base = { de: "2026-03-10" };
    const lista = async (p: Record<string, string>) => (await listarVendasDetalhadas(filtro({ ...base, ...p }))).vendas.map((v) => v.id).sort();

    expect(await lista({})).toHaveLength(4);
    expect(await lista({ funcionario: ids.beto })).toEqual([betoDinheiro]);
    expect(await lista({ terminal: TERMINAL_B })).toEqual([betoDinheiro]);
    expect(await lista({ caixa: cxB })).toEqual([betoDinheiro]);
    expect(await lista({ caixa: cxA, forma: "pix" })).toEqual([anaPix]);
    expect(await lista({ funcionario: ids.ana, situacao: "canceladas" })).toEqual([cancelada]);
    expect(await lista({ funcionario: ids.ana, situacao: "ativas", forma: "dinheiro" })).toEqual([anaDinheiro]);
    expect(await lista({ funcionario: ids.beto, forma: "pix" })).toEqual([]);
  });

  it("terminal é o do caixa em que a venda foi lançada (e um terminal desconhecido não devolve nada)", async () => {
    const cxA = await abrir(TERMINAL_A, ids.ana, em("2026-03-10", "07:00"));
    const cxB = await abrir(TERMINAL_B, ids.beto, em("2026-03-10", "07:00"));
    const a = await vender(cxA, TERMINAL_A, ids.ana, em("2026-03-10", "10:00"));
    const b = await vender(cxB, TERMINAL_B, ids.beto, em("2026-03-10", "11:00"));
    const lista = async (terminal: string) => (await listarVendasDetalhadas(filtro({ de: "2026-03-10", terminal }))).vendas.map((v) => v.id);
    expect(await lista(TERMINAL_A)).toEqual([a]);
    expect(await lista(TERMINAL_B)).toEqual([b]);
    expect(await lista("terminal-que-nao-existe")).toEqual([]);
    const ruim = lerFiltroVendas({ de: "2026-03-10", terminal: "x'; DROP TABLE vendas;--" }, new Date("2026-03-12T12:00:00Z"));
    expect(ruim.filtro.terminal_id).toBeNull();
    expect(ruim.avisos.join(" ")).toMatch(/Terminal inválido/);
  });
});

describe("pagamento misto e conciliação com o banco", () => {
  it("venda dividida (dinheiro 20 + Pix 30): total uma vez, partes somam o total, filtro por forma encontra", async () => {
    const caixa = await abrir(TERMINAL_A, ids.ana, em("2026-03-10", "07:00"));
    const id = await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "10:00"), {
      total: 50,
      pagamentos: [
        { forma: "dinheiro", valor_centavos: 2000 },
        { forma: "pix", valor_centavos: 3000 },
      ],
    });
    const r = await listarVendasDetalhadas(filtro({ de: "2026-03-10" }));
    const v = r.vendas[0];
    expect(v.id).toBe(id);
    expect(v.forma_pagamento).toBe("misto");
    expect(v.pagamentos).toEqual([
      { forma: "dinheiro", valor_centavos: 2000 },
      { forma: "pix", valor_centavos: 3000 },
    ]);
    expect(v.pagamentos.reduce((s, p) => s + p.valor_centavos, 0)).toBe(v.total_centavos);
    expect(resumirPagamentos(r.vendas).reduce((s, l) => s + l.total_centavos, 0)).toBe(5000);

    for (const forma of ["dinheiro", "pix"]) expect((await listarVendasDetalhadas(filtro({ de: "2026-03-10", forma }))).vendas).toHaveLength(1);
    expect((await listarVendasDetalhadas(filtro({ de: "2026-03-10", forma: "credito" }))).vendas).toHaveLength(0);
  });

  it("totais da planilha == SQL do banco (vendas válidas e lançamentos do caixa)", async () => {
    const caixa = await abrir(TERMINAL_A, ids.ana, em("2026-03-10", "07:00"));
    await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "09:00"), { total: 30 });
    await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "10:00"), { total: 50, pagamentos: [{ forma: "dinheiro", valor_centavos: 2000 }, { forma: "pix", valor_centavos: 3000 }] });
    await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "21:44:11"), { total: 25, forma: "pix" });
    const cancelada = await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "15:00"), { total: 99 });
    await prisma.venda.update({ where: { id: cancelada }, data: { cancelada: true } });

    const f = filtro({ de: "2026-03-10" });
    const { vendas } = await listarVendasDetalhadas(f);
    const t = totaisConferencia(vendas);

    const [{ total_vendas }] = await prisma.$queryRaw<{ total_vendas: bigint }[]>`
      SELECT COALESCE(SUM(ROUND(total * 100)), 0)::bigint AS total_vendas FROM vendas WHERE cancelada = false`;
    const [{ total_mov }] = await prisma.$queryRaw<{ total_mov: bigint }[]>`
      SELECT COALESCE(SUM(m.valor_centavos), 0)::bigint AS total_mov
      FROM movimentos_caixa m JOIN vendas v ON v.id = m.venda_id WHERE m.tipo = 'venda' AND v.cancelada = false`;
    expect(t.totalVendasCentavos).toBe(Number(total_vendas));
    expect(t.totalPagamentosCentavos).toBe(Number(total_mov));
    expect(t.diferencaCentavos).toBe(0);
    expect(t.totalVendasCentavos).toBe(3000 + 5000 + 2500);

    // o que está escrito nas células da planilha também fecha com o banco
    const xlsx = gerarXlsx(montarPlanilhas({ filtro: f, vendas, caixas: [], geradoEm: new Date(), truncado: false, rotulos: { funcionario: null, terminal: null, turno: null } }));
    const aba = lerAba(lerZip(xlsx).get("xl/worksheets/sheet2.xml")!.toString());
    let soma = 0;
    for (let r = 2; aba.has(`H${r}`); r++) if (aba.get(`K${r}`)!.texto === "Válida") soma += Math.round(aba.get(`H${r}`)!.numero! * 100);
    expect(soma).toBe(Number(total_vendas));
  });
});

describe("dashboard: 'hoje' é o dia da loja", () => {
  it("às 21h50 (00h50 UTC do dia seguinte) a venda das 21h44 ainda conta como hoje; à 00h10 local, não", async () => {
    const caixa = await abrir(TERMINAL_A, ids.ana, em("2026-03-10", "08:00"));
    await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "21:44:11"), { total: 40 });

    const noMesmoDia = await buscarResumoDashboard(new Date("2026-03-11T00:50:00.000Z")); // 21:50 do dia 10 na loja
    expect(noMesmoDia.quantidadeVendasHoje).toBe(1);
    expect(Number(noMesmoDia.faturamentoHoje)).toBe(40);

    const diaSeguinte = await buscarResumoDashboard(new Date("2026-03-11T03:10:00.000Z")); // 00:10 do dia 11 na loja
    expect(diaSeguinte.quantidadeVendasHoje).toBe(0);
  });
});

describe("fechamento de turno", () => {
  it("fecha, aparece na planilha com esperado/contado/diferença, e não mexe em estoque nem duplica lançamentos", async () => {
    const caixa = await abrir(TERMINAL_A, ids.ana, em("2026-03-10", "08:00"), 10000);
    await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "10:00"), { total: 30 });
    await vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "11:00"), { total: 50, pagamentos: [{ forma: "dinheiro", valor_centavos: 2000 }, { forma: "pix", valor_centavos: 3000 }] });

    const [antes] = await listarCaixas({ ids: [caixa] });
    const esperadoDinheiro = antes.resumo.dinheiro.saldo_esperado_centavos; // 10000 + 3000 + 2000
    expect(esperadoDinheiro).toBe(15000);
    const estoqueAntes = await prisma.movimentacaoEstoque.count();
    const lancamentosAntes = await prisma.movimentoCaixa.count();

    const fechar = () =>
      fecharCaixa(
        { caixa_id: caixa, fechado_em: em("2026-03-10", "21:55"), conferencia: { dinheiro_centavos: esperadoDinheiro - 300, pix_centavos: 3000, credito_centavos: 0, debito_centavos: 0 }, justificativa: "Troco errado", exigirJustificativa: true },
        autoria(ids.beto, TERMINAL_A)
      );
    const primeira = await fechar();
    expect(primeira.status).toBe("ok");

    // idempotente: fechar de novo não duplica nem reabre
    const segunda = await fechar();
    expect(segunda).toMatchObject({ status: "ok", jaExistia: true });
    expect(await prisma.movimentacaoEstoque.count()).toBe(estoqueAntes);
    expect(await prisma.movimentoCaixa.count()).toBe(lancamentosAntes);
    expect((await prisma.caixa.findUniqueOrThrow({ where: { id: caixa } })).status).toBe("fechado");

    const [fechado] = await listarCaixas({ ids: [caixa] });
    const aba = abaFechamentos([fechado]);
    const c = Object.fromEntries(aba.colunas.map((col, i) => [col.titulo, aba.linhas[0][i]]));
    expect(c["Saldo inicial"]).toEqual({ centavos: 10000 });
    expect(c["Total esperado"]).toEqual({ centavos: 15000 + 3000 });
    expect(c["Contado: dinheiro"]).toEqual({ centavos: 14700 });
    expect(c["Total contado"]).toEqual({ centavos: 14700 + 3000 });
    expect(c["Diferença total"]).toEqual({ centavos: -300 });
    expect(c["Justificativa"]).toBe("Troco errado");
    expect(c["Aberto por"]).toBe("Ana");
    expect(c["Fechado por"]).toBe("Beto");
    expect(c["Fechado em"]).toBe("10/03/2026 21:55:00");
  });

  it("um caixa fechado não volta a ser aberto sozinho (nova venda é recusada)", async () => {
    const caixa = await abrir(TERMINAL_A, ids.ana, em("2026-03-10", "08:00"));
    const [c0] = await listarCaixas({ ids: [caixa] });
    await fecharCaixa({ caixa_id: caixa, fechado_em: em("2026-03-10", "20:00"), conferencia: { dinheiro_centavos: c0.resumo.dinheiro.saldo_esperado_centavos } }, autoria(ids.ana, TERMINAL_A));
    await expect(vender(caixa, TERMINAL_A, ids.ana, em("2026-03-10", "20:30"))).rejects.toThrow(/caixa/i);
    expect((await prisma.caixa.findUniqueOrThrow({ where: { id: caixa } })).status).toBe("fechado");
  });
});
