import { describe, it, expect } from "vitest";
import { calcularDiferencas, formatarCentavos, haDivergencia, reaisParaCentavos, resumirCaixa } from "../calculo";
import { statusExibicao, type MovimentoResumo } from "../tipos";

let seq = 0;
function mov(p: Partial<MovimentoResumo> & Pick<MovimentoResumo, "tipo" | "forma_pagamento" | "valor_centavos">): MovimentoResumo {
  seq++;
  return {
    id: `m${seq}`,
    sentido: ["sangria", "despesa", "outra_saida", "ajuste_saida"].includes(p.tipo) ? "saida" : "entrada",
    estorno_de_id: null,
    venda_id: p.tipo === "venda" ? `v${seq}` : null,
    cartao_taxa_centavos: null,
    ...p,
  };
}

describe("resumirCaixa — dinheiro", () => {
  it("fundo + vendas em dinheiro + suprimento − sangria − despesa = saldo esperado", () => {
    const r = resumirCaixa(10000, [
      mov({ tipo: "venda", forma_pagamento: "dinheiro", valor_centavos: 2500 }),
      mov({ tipo: "venda", forma_pagamento: "dinheiro", valor_centavos: 1050 }),
      mov({ tipo: "suprimento", forma_pagamento: "dinheiro", valor_centavos: 5000 }),
      mov({ tipo: "sangria", forma_pagamento: "dinheiro", valor_centavos: 8000 }),
      mov({ tipo: "despesa", forma_pagamento: "dinheiro", valor_centavos: 1200 }),
    ]);
    expect(r.dinheiro.entradas_vendas_centavos).toBe(3550);
    expect(r.dinheiro.suprimentos_centavos).toBe(5000);
    expect(r.dinheiro.sangrias_centavos).toBe(8000);
    expect(r.dinheiro.despesas_centavos).toBe(1200);
    expect(r.dinheiro.saldo_esperado_centavos).toBe(10000 + 3550 + 5000 - 8000 - 1200);
  });

  it("o fundo inicial NÃO conta como venda nem como recebido", () => {
    const r = resumirCaixa(10000, []);
    expect(r.total_vendas_centavos).toBe(0);
    expect(r.total_recebido_centavos).toBe(0);
    expect(r.total_entradas_centavos).toBe(0);
    expect(r.dinheiro.saldo_esperado_centavos).toBe(10000);
  });

  it("Pix e cartão não entram no saldo físico de dinheiro", () => {
    const r = resumirCaixa(0, [
      mov({ tipo: "venda", forma_pagamento: "pix", valor_centavos: 1000 }),
      mov({ tipo: "venda", forma_pagamento: "credito", valor_centavos: 2000 }),
      mov({ tipo: "venda", forma_pagamento: "debito", valor_centavos: 3000 }),
    ]);
    expect(r.dinheiro.saldo_esperado_centavos).toBe(0);
    expect(r.por_forma.pix.saldo_centavos).toBe(1000);
    expect(r.por_forma.credito.saldo_centavos).toBe(2000);
    expect(r.por_forma.debito.saldo_centavos).toBe(3000);
    expect(r.total_recebido_centavos).toBe(6000);
  });
});

describe("resumirCaixa — fiado não é dinheiro recebido", () => {
  it("fiado soma no faturamento, mas não no recebido, nas entradas nem no dinheiro", () => {
    const r = resumirCaixa(0, [
      mov({ tipo: "venda", forma_pagamento: "fiado", valor_centavos: 4000 }),
      mov({ tipo: "venda", forma_pagamento: "dinheiro", valor_centavos: 1000 }),
    ]);
    expect(r.total_vendas_centavos).toBe(5000);
    expect(r.total_recebido_centavos).toBe(1000);
    expect(r.total_entradas_centavos).toBe(1000);
    expect(r.dinheiro.saldo_esperado_centavos).toBe(1000);
  });

  it("o recebimento da conta entra como dinheiro/Pix só quando recebido, e não é venda", () => {
    const r = resumirCaixa(0, [
      mov({ tipo: "venda", forma_pagamento: "fiado", valor_centavos: 4000 }),
      mov({ tipo: "recebimento_conta", forma_pagamento: "dinheiro", valor_centavos: 1500 }),
    ]);
    expect(r.total_vendas_centavos).toBe(4000);
    expect(r.total_recebido_centavos).toBe(1500);
    expect(r.dinheiro.recebimentos_conta_centavos).toBe(1500);
    expect(r.dinheiro.saldo_esperado_centavos).toBe(1500);
  });
});

describe("resumirCaixa — pagamento dividido", () => {
  it("uma venda com duas formas gera duas linhas e conta UMA venda", () => {
    const venda = "v-split";
    const r = resumirCaixa(0, [
      mov({ tipo: "venda", forma_pagamento: "dinheiro", valor_centavos: 600, venda_id: venda }),
      mov({ tipo: "venda", forma_pagamento: "pix", valor_centavos: 400, venda_id: venda }),
    ]);
    expect(r.quantidade_vendas).toBe(1);
    expect(r.total_vendas_centavos).toBe(1000);
    expect(r.por_forma.dinheiro.saldo_centavos).toBe(600);
    expect(r.por_forma.pix.saldo_centavos).toBe(400);
  });
});

describe("resumirCaixa — cartão: bruto, taxas conhecidas e líquido previsto", () => {
  it("taxa conhecida reduz só o líquido previsto; taxa desconhecida é contada e NUNCA presumida", () => {
    const r = resumirCaixa(0, [
      mov({ tipo: "venda", forma_pagamento: "credito", valor_centavos: 10000, cartao_taxa_centavos: 350 }),
      mov({ tipo: "venda", forma_pagamento: "credito", valor_centavos: 5000, cartao_taxa_centavos: null }),
    ]);
    const c = r.por_forma.credito;
    expect(c.saldo_centavos).toBe(15000); // bruto, intocado
    expect(c.taxas_conhecidas_centavos).toBe(350);
    expect(c.operacoes_sem_taxa).toBe(1);
    expect(c.liquido_previsto_centavos).toBe(14650);
    expect(r.total_vendas_centavos).toBe(15000); // faturamento é bruto
  });

  it("uma venda de cartão estornada deixa de contar taxas e quantidade", () => {
    const original = mov({ tipo: "venda", forma_pagamento: "debito", valor_centavos: 2000, cartao_taxa_centavos: 40 });
    const estorno = mov({ tipo: "estorno", sentido: "saida", forma_pagamento: "debito", valor_centavos: 2000, estorno_de_id: original.id });
    const r = resumirCaixa(0, [original, estorno]);
    expect(r.por_forma.debito.saldo_centavos).toBe(0);
    expect(r.por_forma.debito.taxas_conhecidas_centavos).toBe(0);
    expect(r.por_forma.debito.quantidade).toBe(0);
  });
});

describe("resumirCaixa — estornos", () => {
  it("cancelar uma venda em dinheiro devolve o dinheiro e tira do faturamento e do recebido", () => {
    const original = mov({ tipo: "venda", forma_pagamento: "dinheiro", valor_centavos: 3000, venda_id: "v1" });
    const estorno = mov({ tipo: "estorno", sentido: "saida", forma_pagamento: "dinheiro", valor_centavos: 3000, estorno_de_id: original.id });
    const r = resumirCaixa(5000, [original, estorno]);
    expect(r.total_vendas_centavos).toBe(0);
    expect(r.total_recebido_centavos).toBe(0);
    expect(r.quantidade_vendas).toBe(0);
    expect(r.dinheiro.saldo_esperado_centavos).toBe(5000);
  });

  it("estornar uma sangria devolve o dinheiro ao caixa", () => {
    const sangria = mov({ tipo: "sangria", forma_pagamento: "dinheiro", valor_centavos: 2000 });
    const estorno = mov({ tipo: "estorno", sentido: "entrada", forma_pagamento: "dinheiro", valor_centavos: 2000, estorno_de_id: sangria.id });
    const r = resumirCaixa(10000, [sangria, estorno]);
    expect(r.dinheiro.saldo_esperado_centavos).toBe(10000);
  });
});

describe("conferência e diferenças", () => {
  const resumo = resumirCaixa(10000, [
    mov({ tipo: "venda", forma_pagamento: "dinheiro", valor_centavos: 2000 }),
    mov({ tipo: "venda", forma_pagamento: "pix", valor_centavos: 1500 }),
  ]);

  it("fechamento com saldo correto: sem diferença", () => {
    const d = calcularDiferencas(resumo, { dinheiro_centavos: 12000, pix_centavos: 1500 });
    expect(d.diferenca_dinheiro_centavos).toBe(0);
    expect(d.diferenca_total_centavos).toBe(0);
    expect(haDivergencia(d)).toBe(false);
  });

  it("fechamento com divergência: falta dinheiro e sobra Pix", () => {
    const d = calcularDiferencas(resumo, { dinheiro_centavos: 11850, pix_centavos: 1600 });
    expect(d.diferenca_dinheiro_centavos).toBe(-150);
    expect(d.por_forma.find((p) => p.forma === "pix")?.diferenca_centavos).toBe(100);
    expect(d.diferenca_total_centavos).toBe(-50);
    expect(haDivergencia(d)).toBe(true);
  });

  it("forma não conferida não gera diferença (fica sem valor informado)", () => {
    const d = calcularDiferencas(resumo, { dinheiro_centavos: 12000 });
    expect(d.por_forma.find((p) => p.forma === "pix")?.diferenca_centavos).toBeNull();
    expect(haDivergencia(d)).toBe(false);
  });
});

describe("dinheiro em centavos, sem ponto flutuante", () => {
  it("0,10 + 0,20 não vira 0,30000000000000004", () => {
    const r = resumirCaixa(0, [
      mov({ tipo: "venda", forma_pagamento: "dinheiro", valor_centavos: reaisParaCentavos("0,10")! }),
      mov({ tipo: "venda", forma_pagamento: "dinheiro", valor_centavos: reaisParaCentavos("0,20")! }),
    ]);
    expect(r.dinheiro.saldo_esperado_centavos).toBe(30);
  });

  it.each([
    ["12,50", 1250],
    ["12.5", 1250],
    ["12", 1200],
    ["0,05", 5],
    ["R$ 1.000", null],
    ["1,234", null],
    ["-3", null],
    ["abc", null],
    ["", null],
  ])("reaisParaCentavos(%j) = %s", (texto, esperado) => {
    expect(reaisParaCentavos(texto)).toBe(esperado);
  });

  it("formatarCentavos", () => {
    expect(formatarCentavos(123456)).toBe("R$ 1.234,56");
    expect(formatarCentavos(-5)).toBe("-R$ 0,05");
    expect(formatarCentavos(0)).toBe("R$ 0,00");
  });
});

describe("statusExibicao", () => {
  const base = { fechamentoConfirmadoNoServidor: true, diferenca_total_centavos: 0, conferencia_status: null } as const;
  it("aberto", () => expect(statusExibicao({ ...base, status: "aberto" })).toBe("aberto"));
  it("fechado só no aparelho NUNCA aparece como confirmado", () =>
    expect(statusExibicao({ ...base, status: "fechado", fechamentoConfirmadoNoServidor: false })).toBe("fechamento_pendente_sincronizacao"));
  it("fechado no servidor sem diferença", () => expect(statusExibicao({ ...base, status: "fechado" })).toBe("fechado"));
  it("diferença ainda sem revisão do administrador", () =>
    expect(statusExibicao({ ...base, status: "fechado", diferenca_total_centavos: -100, conferencia_status: "pendente" })).toBe("aguardando_conferencia"));
  it("diferença revisada", () =>
    expect(statusExibicao({ ...base, status: "fechado", diferenca_total_centavos: -100, conferencia_status: "conferido" })).toBe("com_divergencia"));
});
