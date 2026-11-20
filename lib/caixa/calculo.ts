import {
  CHAVE_CONFERENCIA,
  FORMAS_CAIXA,
  type ConferenciaInformada,
  type DiferencaForma,
  type FormaCaixa,
  type LinhaFormaResumo,
  type MovimentoResumo,
  type ResumoCaixa,
} from "./tipos";

/**
 * Cálculo do resumo do caixa — função PURA em centavos inteiros. É a mesma função usada pelo servidor
 * (resumo oficial do fechamento) e pelo aparelho (painel e resumo local offline), então os dois só
 * divergem se os MOVIMENTOS divergirem.
 *
 * Conceitos que NÃO se misturam:
 *  - total_vendas: faturamento das vendas (inclui fiado), líquido de estornos de venda;
 *  - total_recebido: dinheiro/Pix/cartão que de fato entrou (vendas + recebimentos de conta), sem fiado;
 *  - saldo de dinheiro: o que deve haver FISICAMENTE na gaveta;
 *  - líquido previsto de cartão: bruto − taxas CONHECIDAS (previsão, nunca faturamento).
 */

const FORMAS_COM_CONFERENCIA = ["dinheiro", "pix", "credito", "debito"] as const;

function linhaVazia(forma: FormaCaixa): LinhaFormaResumo {
  return {
    forma,
    entradas_centavos: 0,
    saidas_centavos: 0,
    saldo_centavos: 0,
    quantidade: 0,
    taxas_conhecidas_centavos: 0,
    operacoes_sem_taxa: 0,
    liquido_previsto_centavos: 0,
  };
}

export function resumirCaixa(fundoInicialCentavos: number, movimentos: MovimentoResumo[]): ResumoCaixa {
  const porId = new Map(movimentos.map((m) => [m.id, m]));
  const estornados = new Set(movimentos.map((m) => m.estorno_de_id).filter((x): x is string => Boolean(x)));

  const por_forma = Object.fromEntries(FORMAS_CAIXA.map((f) => [f, linhaVazia(f)])) as Record<FormaCaixa, LinhaFormaResumo>;
  const d = {
    entradas_vendas_centavos: 0,
    recebimentos_conta_centavos: 0,
    suprimentos_centavos: 0,
    outras_entradas_centavos: 0,
    sangrias_centavos: 0,
    despesas_centavos: 0,
    outras_saidas_centavos: 0,
    estornos_centavos: 0,
  };
  let totalVendas = 0;
  let totalRecebido = 0;
  let totalEntradas = 0;
  let totalSaidas = 0;
  const vendasComMovimento = new Map<string, { total: number; estornadas: number }>();

  for (const m of movimentos) {
    const linha = por_forma[m.forma_pagamento];
    const entrada = m.sentido === "entrada";
    const v = m.valor_centavos;
    if (entrada) linha.entradas_centavos += v;
    else linha.saidas_centavos += v;

    const originalEstornado = estornados.has(m.id);
    const ehOperacaoDeRecebimento = (m.tipo === "venda" || m.tipo === "recebimento_conta") && entrada;
    if (ehOperacaoDeRecebimento && !originalEstornado) linha.quantidade++;

    // Taxas só contam em operações de cartão que continuam valendo (não estornadas).
    if (ehOperacaoDeRecebimento && !originalEstornado && (m.forma_pagamento === "credito" || m.forma_pagamento === "debito")) {
      if (m.cartao_taxa_centavos == null) linha.operacoes_sem_taxa++;
      else linha.taxas_conhecidas_centavos += m.cartao_taxa_centavos;
    }

    if (m.forma_pagamento !== "fiado") {
      if (entrada) totalEntradas += v;
      else totalSaidas += v;
    }

    if (m.tipo === "venda") {
      totalVendas += v;
      if (m.forma_pagamento !== "fiado") totalRecebido += v;
      if (m.venda_id) {
        const reg = vendasComMovimento.get(m.venda_id) ?? { total: 0, estornadas: 0 };
        reg.total++;
        if (originalEstornado) reg.estornadas++;
        vendasComMovimento.set(m.venda_id, reg);
      }
    } else if (m.tipo === "recebimento_conta") {
      totalRecebido += v;
    } else if (m.tipo === "estorno") {
      const origem = m.estorno_de_id ? porId.get(m.estorno_de_id) : undefined;
      if (origem?.tipo === "venda") {
        totalVendas -= v;
        if (m.forma_pagamento !== "fiado") totalRecebido -= v;
      } else if (origem?.tipo === "recebimento_conta") {
        totalRecebido -= v;
      }
    }

    if (m.forma_pagamento === "dinheiro") {
      const efeito = entrada ? v : -v;
      switch (m.tipo) {
        case "venda": d.entradas_vendas_centavos += efeito; break;
        case "recebimento_conta": d.recebimentos_conta_centavos += efeito; break;
        case "suprimento": d.suprimentos_centavos += efeito; break;
        case "outra_entrada":
        case "ajuste_entrada": d.outras_entradas_centavos += efeito; break;
        case "sangria": d.sangrias_centavos -= efeito; break;
        case "despesa": d.despesas_centavos -= efeito; break;
        case "outra_saida":
        case "ajuste_saida": d.outras_saidas_centavos -= efeito; break;
        case "estorno": d.estornos_centavos += efeito; break;
      }
    }
  }

  for (const f of FORMAS_CAIXA) {
    const l = por_forma[f];
    l.saldo_centavos = l.entradas_centavos - l.saidas_centavos;
    l.liquido_previsto_centavos = l.saldo_centavos - l.taxas_conhecidas_centavos;
  }

  const quantidadeVendas = [...vendasComMovimento.values()].filter((r) => r.estornadas < r.total).length;

  return {
    fundo_inicial_centavos: fundoInicialCentavos,
    por_forma,
    dinheiro: {
      fundo_inicial_centavos: fundoInicialCentavos,
      ...d,
      saldo_esperado_centavos: fundoInicialCentavos + por_forma.dinheiro.saldo_centavos,
    },
    total_vendas_centavos: totalVendas,
    total_recebido_centavos: totalRecebido,
    total_entradas_centavos: totalEntradas,
    total_saidas_centavos: totalSaidas,
    quantidade_movimentos: movimentos.length,
    quantidade_vendas: quantidadeVendas,
  };
}

/** Valor esperado em cada forma conferível (dinheiro inclui o fundo inicial). */
export function esperadoPorForma(resumo: ResumoCaixa, forma: (typeof FORMAS_COM_CONFERENCIA)[number]): number {
  return forma === "dinheiro" ? resumo.dinheiro.saldo_esperado_centavos : resumo.por_forma[forma].saldo_centavos;
}

export function calcularDiferencas(
  resumo: ResumoCaixa,
  conferencia: ConferenciaInformada
): { por_forma: DiferencaForma[]; diferenca_dinheiro_centavos: number | null; diferenca_total_centavos: number } {
  const por_forma: DiferencaForma[] = FORMAS_COM_CONFERENCIA.map((forma) => {
    const esperado = esperadoPorForma(resumo, forma);
    const bruto = conferencia[CHAVE_CONFERENCIA[forma]];
    const informado = typeof bruto === "number" ? bruto : null;
    return {
      forma,
      esperado_centavos: esperado,
      informado_centavos: informado,
      diferenca_centavos: informado === null ? null : informado - esperado,
    };
  });
  const dinheiro = por_forma.find((p) => p.forma === "dinheiro")!;
  return {
    por_forma,
    diferenca_dinheiro_centavos: dinheiro.diferenca_centavos,
    diferenca_total_centavos: por_forma.reduce((s, p) => s + (p.diferenca_centavos ?? 0), 0),
  };
}

/** True se alguma forma conferida tem diferença — exige justificativa no fechamento. */
export function haDivergencia(diferencas: ReturnType<typeof calcularDiferencas>): boolean {
  return diferencas.por_forma.some((p) => (p.diferenca_centavos ?? 0) !== 0);
}

/** "12,50" | "12.5" | "1250" → centavos inteiros (sem passar por ponto flutuante). null se inválido. */
export function reaisParaCentavos(texto: string): number | null {
  const t = texto.trim().replace(/^R\$\s*/, "");
  if (!/^\d{1,9}([.,]\d{1,2})?$/.test(t)) return null;
  const [inteiro, frac = ""] = t.split(/[.,]/);
  return Number(inteiro) * 100 + Number(frac.padEnd(2, "0"));
}

export function formatarCentavos(centavos: number): string {
  const sinal = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  const reais = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sinal}R$ ${reais},${String(abs % 100).padStart(2, "0")}`;
}
