import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { validarMovimentoAvulso, validarPagamentosVenda, centavosOk } from "../validacao";
import { csvMovimentos, paraCsv, porOperador, porTerminal, vendasPorForma, divergencias, type CaixaRel, type MovimentoRel } from "../relatorios";

describe("validarPagamentosVenda", () => {
  it("aceita uma forma com o total", () => {
    expect(validarPagamentosVenda([{ forma: "pix", valor_centavos: 1000 }], 1000)).toEqual([]);
  });

  it("aceita pagamento dividido cuja soma fecha o total", () => {
    expect(
      validarPagamentosVenda(
        [
          { forma: "dinheiro", valor_centavos: 600 },
          { forma: "credito", valor_centavos: 400, cartao: { parcelas: 3, bandeira: "Visa", taxa_centavos: 12 } },
        ],
        1000
      )
    ).toEqual([]);
  });

  it("recusa soma diferente do total (a maior ou a menor)", () => {
    expect(validarPagamentosVenda([{ forma: "pix", valor_centavos: 999 }], 1000)[0]).toMatch(/não confere/);
    expect(validarPagamentosVenda([{ forma: "pix", valor_centavos: 600 }, { forma: "dinheiro", valor_centavos: 500 }], 1000)[0]).toMatch(/não confere/);
  });

  it.each([
    ["valor zero", [{ forma: "pix", valor_centavos: 0 }]],
    ["valor negativo", [{ forma: "pix", valor_centavos: -100 }]],
    ["valor fracionado", [{ forma: "pix", valor_centavos: 10.5 }]],
    ["forma inválida", [{ forma: "cheque", valor_centavos: 1000 }]],
    ["lista vazia", []],
    ["não é lista", "pix"],
    ["cartão em Pix", [{ forma: "pix", valor_centavos: 1000, cartao: { bandeira: "Visa" } }]],
    ["parcelas inválidas", [{ forma: "credito", valor_centavos: 1000, cartao: { parcelas: 0 } }]],
    ["débito parcelado", [{ forma: "debito", valor_centavos: 1000, cartao: { parcelas: 2 } }]],
    ["taxa maior que o valor", [{ forma: "credito", valor_centavos: 1000, cartao: { taxa_centavos: 1001 } }]],
  ])("recusa %s", (_nome, pagamentos) => {
    expect(validarPagamentosVenda(pagamentos, 1000).length).toBeGreaterThan(0);
  });
});

describe("validarMovimentoAvulso — sangria/suprimento exigem valor, motivo e identificação", () => {
  const ok = { id: randomUUID(), caixa_id: randomUUID(), tipo: "sangria", valor_centavos: 5000, justificativa: "Recolhimento", ocorrido_em: new Date().toISOString() };

  it("aceita um movimento completo", () => expect(validarMovimentoAvulso(ok)).toEqual([]));
  it("exige motivo", () => expect(validarMovimentoAvulso({ ...ok, justificativa: "  " }).join()).toMatch(/motivo/));
  it("exige valor positivo e inteiro", () => {
    expect(validarMovimentoAvulso({ ...ok, valor_centavos: 0 }).length).toBeGreaterThan(0);
    expect(validarMovimentoAvulso({ ...ok, valor_centavos: -1 }).length).toBeGreaterThan(0);
    expect(validarMovimentoAvulso({ ...ok, valor_centavos: 10.5 }).length).toBeGreaterThan(0);
  });
  it("recusa tipo desconhecido (inclusive 'venda' e 'estorno', que têm fluxo próprio)", () => {
    expect(validarMovimentoAvulso({ ...ok, tipo: "venda" }).length).toBeGreaterThan(0);
    expect(validarMovimentoAvulso({ ...ok, tipo: "estorno" }).length).toBeGreaterThan(0);
  });
  it("centavosOk respeita o teto", () => {
    expect(centavosOk(999_999_999)).toBe(true);
    expect(centavosOk(1_000_000_000)).toBe(false);
    expect(centavosOk(0, { permitirZero: true })).toBe(true);
  });
});

function m(p: Partial<MovimentoRel>): MovimentoRel {
  return {
    id: randomUUID(), caixa_id: "c1", tipo: "venda", sentido: "entrada", forma_pagamento: "dinheiro", valor_centavos: 100,
    funcionario_id: "f1", funcionario_nome: "Ana", dispositivo: "t1", origem: "online", estorno_de_id: null,
    descricao: null, justificativa: null, ocorrido_em: "2026-01-01T10:00:00Z", ...p,
  };
}

describe("relatórios derivados", () => {
  it("vendas por forma de pagamento descontam estornos", () => {
    const v = m({ forma_pagamento: "pix", valor_centavos: 1000 });
    const e = m({ tipo: "estorno", sentido: "saida", forma_pagamento: "pix", valor_centavos: 1000, estorno_de_id: v.id });
    const t = vendasPorForma([v, e, m({ forma_pagamento: "dinheiro", valor_centavos: 300 })]);
    expect(t.pix).toBe(0);
    expect(t.dinheiro).toBe(300);
  });

  it("por operador separa a autoria de cada funcionário", () => {
    const l = porOperador([
      m({ funcionario_id: "a", funcionario_nome: "Ana", valor_centavos: 100 }),
      m({ funcionario_id: "b", funcionario_nome: "Bia", valor_centavos: 250 }),
      m({ funcionario_id: "b", funcionario_nome: "Bia", tipo: "sangria", sentido: "saida", valor_centavos: 50 }),
    ]);
    expect(l.find((x) => x.funcionario_nome === "Ana")?.vendas_centavos).toBe(100);
    const bia = l.find((x) => x.funcionario_nome === "Bia")!;
    expect(bia.vendas_centavos).toBe(250);
    expect(bia.sangrias_centavos).toBe(50);
  });

  it("por terminal e divergências", () => {
    const resumo = { total_vendas_centavos: 1000, total_recebido_centavos: 900, dinheiro: { saldo_esperado_centavos: 500 } };
    const base = { terminal_papel: null, aberto_em: "", fechado_em: null, aberto_por: "x", fechado_por: null, fundo_inicial_centavos: 0, diferenca_dinheiro_centavos: null, justificativa_divergencia: null, conferencia_status: null, resumo };
    const caixas: CaixaRel[] = [
      { ...base, id: "1", terminal_id: "T1", status: "fechado", diferenca_total_centavos: -100 },
      { ...base, id: "2", terminal_id: "T1", status: "aberto", diferenca_total_centavos: null },
      { ...base, id: "3", terminal_id: "T2", status: "fechado", diferenca_total_centavos: 0 },
    ];
    const t = porTerminal(caixas);
    expect(t.find((x) => x.terminal_id === "T1")).toMatchObject({ caixas: 2, abertos: 1, fechados: 1, com_divergencia: 1 });
    expect(divergencias(caixas).map((c) => c.id)).toEqual(["1"]);
  });
});

describe("CSV", () => {
  it("usa ';' , BOM e escapa aspas e quebras de linha", () => {
    const csv = paraCsv([["a;b", 'diz "oi"', "linha\nnova"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"a;b"');
    expect(csv).toContain('"diz ""oi"""');
  });

  it("neutraliza injeção de fórmula em planilha", () => {
    const csv = csvMovimentos([m({ justificativa: "=HYPERLINK(\"http://x\")" })]);
    expect(csv).not.toMatch(/;=HYPERLINK/);
    expect(csv).toContain("'=HYPERLINK");
  });

  it("valores saem em reais com vírgula, a partir de centavos inteiros", () => {
    expect(csvMovimentos([m({ valor_centavos: 12345 })])).toContain("123,45");
  });
});
