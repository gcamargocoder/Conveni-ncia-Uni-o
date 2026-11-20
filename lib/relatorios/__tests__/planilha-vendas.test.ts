import { describe, expect, it } from "vitest";
import { lerFiltroVendas } from "../filtro";
import { abaFechamentos, abaPagamentos, abaVendas, montarPlanilhas, totaisConferencia, type DadosPlanilha } from "../planilha-vendas";
import { gerarXlsx } from "../xlsx";
import { lerAba, lerZip } from "./ler-zip";
import { paraVendaDetalhada, resumirPagamentos, type VendaDetalhada } from "@/services/relatorios.service";
import { resumirCaixa } from "@/lib/caixa/calculo";
import type { CaixaListado } from "@/services/caixa-consulta.service";
import type { MovimentoResumo } from "@/lib/caixa/tipos";

const T1 = "aaaaaaaa-1111-4111-8111-111111111111";
const C1 = "cccccccc-1111-4111-8111-111111111111";

function venda(p: Partial<VendaDetalhada> & { id: string; created_at: string; total_centavos: number }): VendaDetalhada {
  return {
    total: p.total_centavos / 100,
    forma_pagamento: "dinheiro",
    cancelada: false,
    funcionario_nome: "Maria",
    caixa_id: C1,
    terminal_id: T1,
    terminal_papel: "principal",
    itens: [{ produto: "Café", quantidade: 1, preco_unitario: p.total_centavos / 100, subtotal_centavos: p.total_centavos }],
    pagamentos: [{ forma: "dinheiro", valor_centavos: p.total_centavos }],
    pagamento_inferido: false,
    ...p,
  };
}

const V_21H44 = venda({ id: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", created_at: "2026-11-19T00:44:11.000Z", total_centavos: 2500, forma_pagamento: "pix", pagamentos: [{ forma: "pix", valor_centavos: 2500 }] });
const V_MISTA = venda({
  id: "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  created_at: "2026-11-18T15:30:00.000Z",
  total_centavos: 10000,
  forma_pagamento: "misto",
  pagamentos: [
    { forma: "dinheiro", valor_centavos: 4000 },
    { forma: "pix", valor_centavos: 6000 },
  ],
});
const V_CANCELADA = venda({ id: "33333333-cccc-4ccc-8ccc-cccccccccccc", created_at: "2026-11-18T14:00:00.000Z", total_centavos: 9900, cancelada: true });
const V_OFFLINE = venda({ id: "44444444-dddd-4ddd-8ddd-dddddddddddd", created_at: "2026-11-19T00:10:00.000Z", total_centavos: 700 }); // ocorreu 21h10 do dia 18, sincronizada depois
const VENDAS = [V_21H44, V_MISTA, V_CANCELADA, V_OFFLINE];

const dados = (extra: Partial<DadosPlanilha> = {}): DadosPlanilha => ({
  filtro: lerFiltroVendas({ de: "2026-11-18" }, new Date("2026-11-19T12:00:00Z")).filtro,
  vendas: VENDAS,
  caixas: [],
  geradoEm: new Date("2026-11-19T12:00:00Z"),
  truncado: false,
  rotulos: { funcionario: null, terminal: null, turno: null },
  ...extra,
});

describe("planilha de vendas — horário da loja", () => {
  it("a venda das 21h44 do dia 18 aparece como 18/11/2026 21:44:11 (nunca 19/11 00:44)", () => {
    const aba = abaVendas(dados());
    const linha = aba.linhas.find((l) => l[2] === "11111111")!;
    expect(linha[0]).toBe("18/11/2026");
    expect(linha[1]).toBe("21:44:11");
  });

  it("venda offline sincronizada depois mantém o horário em que ocorreu (21:10 do dia 18)", () => {
    const linha = abaVendas(dados()).linhas.find((l) => l[2] === "44444444")!;
    expect([linha[0], linha[1]]).toEqual(["18/11/2026", "21:10:00"]);
  });
});

describe("planilha de vendas — totais e pagamento misto", () => {
  it("pagamento misto: o total da venda aparece UMA vez e o detalhe soma o mesmo valor", () => {
    const vendasLinha = abaVendas(dados()).linhas.find((l) => l[2] === "22222222")!;
    expect(vendasLinha[7]).toEqual({ centavos: 10000 });
    expect(vendasLinha[8]).toBe("Pagamento dividido");
    expect(vendasLinha[9]).toBe("Dinheiro: R$ 40,00 + Pix: R$ 60,00");

    const pags = abaPagamentos(dados()).linhas.filter((l) => l[2] === "22222222");
    expect(pags.map((l) => (l[4] as { centavos: number }).centavos)).toEqual([4000, 6000]);
  });

  it("totais gerais: canceladas fora; soma de vendas == soma de pagamentos (diferença zero)", () => {
    const t = totaisConferencia(VENDAS);
    expect(t.quantidadeValidas).toBe(3);
    expect(t.quantidadeCanceladas).toBe(1);
    expect(t.totalVendasCentavos).toBe(2500 + 10000 + 700);
    expect(t.totalPagamentosCentavos).toBe(t.totalVendasCentavos);
    expect(t.diferencaCentavos).toBe(0);
    expect(t.totalCanceladasCentavos).toBe(9900);
    const porForma = Object.fromEntries(t.porForma.map((l) => [l.forma, l.total_centavos]));
    expect(porForma).toEqual({ dinheiro: 4000 + 700, pix: 2500 + 6000 });
  });

  it("com filtro de forma, só entram as partes dessa forma e a conferência é 'n/d'", () => {
    const t = totaisConferencia(VENDAS, "pix");
    expect(t.porForma).toEqual([{ forma: "pix", quantidade_vendas: 2, total_centavos: 8500 }]);
    expect(t.diferencaCentavos).toBeNull();
  });

  it("resumirPagamentos conta cada venda uma vez por forma, mesmo dividida em partes da mesma forma", () => {
    const dupla = venda({ id: "55555555-eeee-4eee-8eee-eeeeeeeeeeee", created_at: "2026-11-18T15:00:00Z", total_centavos: 3000, pagamentos: [{ forma: "pix", valor_centavos: 1000 }, { forma: "pix", valor_centavos: 2000 }] });
    expect(resumirPagamentos([dupla])).toEqual([{ forma: "pix", quantidade_vendas: 1, total_centavos: 3000 }]);
  });

  it("planilha final conferida contra os dados: células somadas == totais", () => {
    const xlsx = gerarXlsx(montarPlanilhas(dados()));
    const z = lerZip(xlsx);
    const nomes = z.get("xl/workbook.xml")!.toString();
    expect([...nomes.matchAll(/name="([^"]+)"/g)].map((m) => m[1])).toEqual(["Resumo", "Vendas", "Itens vendidos", "Pagamentos"]);

    // Vendas (aba 2): coluna H = Total. Soma das VÁLIDAS == total do banco; canceladas visíveis mas marcadas.
    const vendas = lerAba(z.get("xl/worksheets/sheet2.xml")!.toString());
    let somaValidas = 0;
    for (let r = 2; r <= VENDAS.length + 1; r++) {
      const total = vendas.get(`H${r}`)!.numero!;
      if (vendas.get(`K${r}`)!.texto === "Válida") somaValidas += Math.round(total * 100);
    }
    expect(somaValidas).toBe(13200);

    // Pagamentos (aba 4): soma das válidas == mesmo número.
    const pags = lerAba(z.get("xl/worksheets/sheet4.xml")!.toString());
    let somaPag = 0;
    for (let r = 2; pags.has(`E${r}`); r++) if (pags.get(`F${r}`)!.texto === "Válida") somaPag += Math.round(pags.get(`E${r}`)!.numero! * 100);
    expect(somaPag).toBe(13200);

    // Resumo (aba 1) diz "Confere".
    const resumo = [...lerAba(z.get("xl/worksheets/sheet1.xml")!.toString()).values()].map((c) => c.texto);
    expect(resumo).toContain("Confere");
  });

  it("resultado truncado é avisado na planilha", () => {
    const xlsx = gerarXlsx(montarPlanilhas(dados({ truncado: true })));
    expect(lerZip(xlsx).get("xl/worksheets/sheet1.xml")!.toString()).toContain("truncado");
  });
});

describe("paraVendaDetalhada — o que vem do banco", () => {
  const base = {
    id: "66666666-ffff-4fff-8fff-ffffffffffff",
    created_at: "2026-11-19T00:44:11.000Z",
    total: 100,
    forma_pagamento: "misto",
    cancelada: false,
    funcionario: { nome: "João" },
    itens: [{ quantidade: 2.5, preco_unitario: 40, produto: { nome: "Carvão" } }],
  };

  it("ordena os pagamentos pela ordem da venda e herda terminal/turno do lançamento", () => {
    const v = paraVendaDetalhada({
      ...base,
      movimentos_caixa: [
        { forma_pagamento: "pix", valor_centavos: 6000, ordem: 1, caixa_id: C1, caixa: { terminal_id: T1, terminal_papel: "principal" } },
        { forma_pagamento: "dinheiro", valor_centavos: 4000, ordem: 0, caixa_id: C1, caixa: { terminal_id: T1, terminal_papel: "principal" } },
      ],
    });
    expect(v.pagamentos.map((p) => p.forma)).toEqual(["dinheiro", "pix"]);
    expect(v.pagamentos.reduce((s, p) => s + p.valor_centavos, 0)).toBe(v.total_centavos);
    expect(v.caixa_id).toBe(C1);
    expect(v.terminal_id).toBe(T1);
    expect(v.itens[0].subtotal_centavos).toBe(10000);
    expect(v.pagamento_inferido).toBe(false);
  });

  it("venda legada sem lançamento de caixa: pagamento inferido do cabeçalho e sinalizado", () => {
    const v = paraVendaDetalhada({ ...base, forma_pagamento: "pix", movimentos_caixa: [] });
    expect(v.pagamentos).toEqual([{ forma: "pix", valor_centavos: 10000 }]);
    expect(v.pagamento_inferido).toBe(true);
    expect(v.caixa_id).toBeNull();
  });

  it("total em reais vira centavos sem erro de ponto flutuante (19,90 → 1990)", () => {
    const v = paraVendaDetalhada({ ...base, total: 19.9, forma_pagamento: "dinheiro", movimentos_caixa: [] });
    expect(v.total_centavos).toBe(1990);
  });
});

describe("fechamento de turno na planilha", () => {
  const mov = (id: string, tipo: MovimentoResumo["tipo"], sentido: "entrada" | "saida", forma: MovimentoResumo["forma_pagamento"], valor: number): MovimentoResumo => ({
    id, tipo, sentido, forma_pagamento: forma, valor_centavos: valor, estorno_de_id: null, venda_id: null, cartao_taxa_centavos: null,
  });
  const movs: MovimentoResumo[] = [
    mov("m1", "venda", "entrada", "dinheiro", 4000),
    mov("m2", "venda", "entrada", "pix", 6000),
    mov("m3", "suprimento", "entrada", "dinheiro", 5000),
    mov("m4", "sangria", "saida", "dinheiro", 2000),
    mov("m5", "despesa", "saida", "dinheiro", 500),
  ];
  const resumo = resumirCaixa(10000, movs);
  const caixa: CaixaListado = {
    id: C1, terminal_id: T1, terminal_papel: "principal", status: "fechado",
    aberto_em: "2026-11-18T11:00:00.000Z", fechado_em: "2026-11-19T00:55:00.000Z",
    fundo_inicial_centavos: 10000, aberto_por: "Maria", fechado_por: "João", origem_abertura: "online", origem_fechamento: "online",
    diferenca_dinheiro_centavos: -300, diferenca_total_centavos: -300, justificativa_divergencia: "Troco errado",
    conferencia_status: "conferido", conferencia_obs: "ok gerente", reaberturas: 0,
    conferencia: { dinheiro_centavos: resumo.dinheiro.saldo_esperado_centavos - 300, pix_centavos: 6000, credito_centavos: 0, debito_centavos: 0 },
    resumo,
  };

  it("traz saldo inicial, entradas por forma, saídas, sangria, suprimento, despesa, esperado, contado, diferença e responsáveis", () => {
    const aba = abaFechamentos([caixa]);
    const c = Object.fromEntries(aba.colunas.map((col, i) => [col.titulo, aba.linhas[0][i]]));
    expect(c["Saldo inicial"]).toEqual({ centavos: 10000 });
    expect(c["Entradas: dinheiro"]).toEqual({ centavos: 9000 }); // venda 4000 + suprimento 5000
    expect(c["Entradas: Pix"]).toEqual({ centavos: 6000 });
    expect(c["Sangrias"]).toEqual({ centavos: 2000 });
    expect(c["Suprimentos"]).toEqual({ centavos: 5000 });
    expect(c["Despesas"]).toEqual({ centavos: 500 });
    // dinheiro esperado = 10000 fundo + 4000 + 5000 − 2000 − 500 = 16500; + pix 6000
    expect(c["Total esperado"]).toEqual({ centavos: 22500 });
    expect(c["Contado: dinheiro"]).toEqual({ centavos: 16200 });
    expect(c["Total contado"]).toEqual({ centavos: 16200 + 6000 });
    expect(c["Diferença total"]).toEqual({ centavos: -300 });
    expect(c["Justificativa"]).toBe("Troco errado");
    expect(c["Aberto por"]).toBe("Maria");
    expect(c["Fechado por"]).toBe("João");
    // fechamento às 21h55 do dia 18 no relógio da loja (00:55Z do dia 19)
    expect(c["Fechado em"]).toBe("18/11/2026 21:55:00");
    expect(c["Situação"]).toBe("Com divergência");
    expect(c["Conferência do administrador"]).toBe("Conferido: ok gerente");
  });

  it("a aba de fechamento só existe quando há turnos (e some para quem não é administrador)", () => {
    expect(montarPlanilhas(dados()).map((p) => p.nome)).not.toContain("Fechamento de turno");
    expect(montarPlanilhas(dados({ caixas: [caixa] })).map((p) => p.nome)).toContain("Fechamento de turno");
  });

  it("turno ainda aberto não inventa valor contado nem fechamento", () => {
    const aberto: CaixaListado = { ...caixa, status: "aberto", fechado_em: null, fechado_por: null, conferencia: null, diferenca_dinheiro_centavos: null, diferenca_total_centavos: null, justificativa_divergencia: null, conferencia_status: null };
    const aba = abaFechamentos([aberto]);
    const c = Object.fromEntries(aba.colunas.map((col, i) => [col.titulo, aba.linhas[0][i]]));
    expect(c["Situação"]).toBe("Aberto");
    expect(c["Total contado"]).toBeNull();
    expect(c["Fechado em"]).toBe("");
  });
});
