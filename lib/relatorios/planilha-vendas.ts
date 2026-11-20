import { CHAVE_CONFERENCIA, FORMAS_CAIXA, ROTULO_FORMA, ROTULO_STATUS, statusExibicao, type FormaCaixa } from "@/lib/caixa/tipos";
import type { CaixaListado } from "@/services/caixa-consulta.service";
import type { VendaDetalhada } from "@/services/relatorios.service";
import { resumirPagamentos } from "@/services/relatorios.service";
import { formatarData, formatarDataHoraComSegundos, formatarHoraComSegundos, instanteLocal } from "@/lib/utils/fuso";
import { ROTULO_SITUACAO, type FiltroVendas } from "./filtro";
import type { Celula, Planilha } from "./xlsx";

/**
 * Monta as abas do Excel a partir dos MESMOS objetos que a tela exibe (listarVendasDetalhadas / listarCaixas).
 * Funções puras: o teste confere os totais da planilha contra os dados de origem.
 *
 * Venda com pagamento dividido: o TOTAL aparece uma vez (aba Vendas); o detalhe por forma fica na aba Pagamentos
 * (uma linha por forma). Somar a coluna "Total" de Vendas ou a coluna "Valor" de Pagamentos dá o mesmo número.
 */

export const rotuloTerminal = (id: string | null, papel: string | null): string =>
  id ? `${papel ? `${papel} ` : ""}${id.slice(0, 8)}` : "—";

const rotuloForma = (forma: string): string => (forma === "misto" ? "Pagamento dividido" : (ROTULO_FORMA as Record<string, string>)[forma] ?? forma);
const numeroVenda = (id: string) => id.slice(0, 8).toUpperCase();
const situacao = (v: VendaDetalhada) => (v.cancelada ? "Cancelada" : "Válida");

export interface DadosPlanilha {
  filtro: FiltroVendas;
  vendas: VendaDetalhada[];
  caixas: CaixaListado[];
  geradoEm: Date;
  truncado: boolean;
  /** Nomes para o cabeçalho de filtros (funcionário/terminal escolhidos). */
  rotulos: { funcionario: string | null; terminal: string | null; turno: string | null };
}

export function descreverFiltro(d: DadosPlanilha): [string, string][] {
  const f = d.filtro;
  const inicio = `${formatarData(instanteLocal(f.dataInicial, "12:00"))}${f.horaInicial ? ` ${f.horaInicial}` : " 00:00"}`;
  const fim = `${formatarData(instanteLocal(f.dataFinal, "12:00"))}${f.horaFinal ? ` ${f.horaFinal}` : " 23:59"}`;
  return [
    ["Período (horário da loja)", `${inicio} a ${fim}`],
    ["Funcionário", d.rotulos.funcionario ?? "Todos"],
    ["Terminal", d.rotulos.terminal ?? "Todos"],
    ["Turno / caixa", d.rotulos.turno ?? "Todos"],
    ["Forma de pagamento", f.forma ? ROTULO_FORMA[f.forma] : "Todas"],
    ["Situação da venda", ROTULO_SITUACAO[f.situacao]],
  ];
}

export function abaVendas(d: DadosPlanilha): Planilha {
  return {
    nome: "Vendas",
    colunas: [
      { titulo: "Data da venda", largura: 14 },
      { titulo: "Horário", largura: 11 },
      { titulo: "Nº da venda", largura: 13 },
      { titulo: "Funcionário", largura: 22 },
      { titulo: "Terminal", largura: 22 },
      { titulo: "Turno (caixa)", largura: 14 },
      { titulo: "Qtd. itens", largura: 11 },
      { titulo: "Total", largura: 14 },
      { titulo: "Forma de pagamento", largura: 22 },
      { titulo: "Detalhamento do pagamento", largura: 44 },
      { titulo: "Situação", largura: 12 },
    ],
    linhas: d.vendas.map((v): Celula[] => [
      formatarData(v.created_at),
      formatarHoraComSegundos(v.created_at),
      numeroVenda(v.id),
      v.funcionario_nome,
      rotuloTerminal(v.terminal_id, v.terminal_papel),
      v.caixa_id ? v.caixa_id.slice(0, 8) : "sem caixa",
      { qtd: v.itens.reduce((s, i) => s + i.quantidade, 0) },
      { centavos: v.total_centavos },
      rotuloForma(v.forma_pagamento),
      v.pagamentos.map((p) => `${rotuloForma(p.forma)}: R$ ${(p.valor_centavos / 100).toFixed(2).replace(".", ",")}`).join(" + ") +
        (v.pagamento_inferido ? " (sem lançamento de caixa)" : ""),
      situacao(v),
    ]),
  };
}

export function abaItens(d: DadosPlanilha): Planilha {
  return {
    nome: "Itens vendidos",
    colunas: [
      { titulo: "Data da venda", largura: 14 },
      { titulo: "Horário", largura: 11 },
      { titulo: "Nº da venda", largura: 13 },
      { titulo: "Produto", largura: 36 },
      { titulo: "Quantidade", largura: 12 },
      { titulo: "Preço unitário", largura: 14 },
      { titulo: "Subtotal", largura: 14 },
      { titulo: "Situação", largura: 12 },
    ],
    linhas: d.vendas.flatMap((v) =>
      v.itens.map((i): Celula[] => [
        formatarData(v.created_at),
        formatarHoraComSegundos(v.created_at),
        numeroVenda(v.id),
        i.produto,
        { qtd: i.quantidade },
        { centavos: Math.round(i.preco_unitario * 100) },
        { centavos: i.subtotal_centavos },
        situacao(v),
      ])
    ),
  };
}

export function abaPagamentos(d: DadosPlanilha): Planilha {
  return {
    nome: "Pagamentos",
    colunas: [
      { titulo: "Data da venda", largura: 14 },
      { titulo: "Horário", largura: 11 },
      { titulo: "Nº da venda", largura: 13 },
      { titulo: "Forma", largura: 24 },
      { titulo: "Valor", largura: 14 },
      { titulo: "Situação", largura: 12 },
    ],
    linhas: d.vendas.flatMap((v) =>
      v.pagamentos
        .filter((p) => !d.filtro.forma || p.forma === d.filtro.forma)
        .map((p): Celula[] => [formatarData(v.created_at), formatarHoraComSegundos(v.created_at), numeroVenda(v.id), rotuloForma(p.forma), { centavos: p.valor_centavos }, situacao(v)])
    ),
  };
}

/** Totais para conferência: o que a planilha soma tem de bater com o banco. */
export function totaisConferencia(vendas: VendaDetalhada[], forma: FormaCaixa | null = null) {
  const validas = vendas.filter((v) => !v.cancelada);
  const totalVendasCentavos = validas.reduce((s, v) => s + v.total_centavos, 0);
  const porForma = resumirPagamentos(vendas, forma);
  const totalPagamentosCentavos = porForma.reduce((s, l) => s + l.total_centavos, 0);
  return {
    quantidadeValidas: validas.length,
    quantidadeCanceladas: vendas.length - validas.length,
    totalVendasCentavos,
    totalCanceladasCentavos: vendas.filter((v) => v.cancelada).reduce((s, v) => s + v.total_centavos, 0),
    porForma,
    totalPagamentosCentavos,
    /** Sem filtro de forma, vendas e pagamentos têm de fechar; com filtro, só as partes da forma entram. */
    diferencaCentavos: forma ? null : totalVendasCentavos - totalPagamentosCentavos,
  };
}

export function abaResumo(d: DadosPlanilha): Planilha {
  const t = totaisConferencia(d.vendas, d.filtro.forma);
  const linhas: Celula[][] = [
    ...descreverFiltro(d).map(([k, v]): Celula[] => [k, v, null]),
    ["Gerado em (horário da loja)", formatarDataHoraComSegundos(d.geradoEm), null],
    ["", null, null],
    ["Vendas válidas (quantidade)", { inteiro: t.quantidadeValidas }, null],
    ["Vendas válidas (total)", { centavos: t.totalVendasCentavos }, null],
    ["Vendas canceladas (quantidade)", { inteiro: t.quantidadeCanceladas }, "não entram nos totais"],
    ["Vendas canceladas (valor)", { centavos: t.totalCanceladasCentavos }, null],
    ["", null, null],
    ...t.porForma.map((l): Celula[] => [`Por forma: ${ROTULO_FORMA[l.forma]}`, { centavos: l.total_centavos }, `${l.quantidade_vendas} venda(s)`]),
    ["Total dos pagamentos", { centavos: t.totalPagamentosCentavos }, null],
    [
      "Conferência vendas × pagamentos",
      t.diferencaCentavos === null ? "n/d (há filtro de forma)" : t.diferencaCentavos === 0 ? "Confere" : "DIFERENÇA",
      t.diferencaCentavos === null ? null : { centavos: t.diferencaCentavos },
    ],
  ];
  if (d.truncado) linhas.push(["", null, null], ["ATENÇÃO", "Resultado truncado: há mais vendas do que o limite da exportação. Reduza o período.", null]);
  return {
    nome: "Resumo",
    colunas: [
      { titulo: "Item", largura: 38 },
      { titulo: "Valor", largura: 44 },
      { titulo: "Observação", largura: 24 },
    ],
    linhas,
  };
}

const FORMAS_CONFERIDAS = FORMAS_CAIXA.filter((f): f is Exclude<FormaCaixa, "fiado"> => f !== "fiado");

export function abaFechamentos(caixas: CaixaListado[]): Planilha {
  const cab = [
    "Turno (caixa)", "Terminal", "Aberto em", "Aberto por", "Fechado em", "Fechado por", "Situação",
    "Saldo inicial",
    "Entradas: dinheiro", "Entradas: Pix", "Entradas: crédito", "Entradas: débito", "Entradas: fiado",
    "Saídas (total)", "Sangrias", "Suprimentos", "Despesas", "Estornos",
    "Total esperado",
    "Contado: dinheiro", "Contado: Pix", "Contado: crédito", "Contado: débito", "Total contado",
    "Diferença: dinheiro", "Diferença total", "Justificativa", "Conferência do administrador",
  ];
  return {
    nome: "Fechamento de turno",
    colunas: cab.map((titulo, i) => ({ titulo, largura: i === 26 ? 40 : i < 7 ? 20 : 15 })),
    linhas: caixas.map((c): Celula[] => {
      const r = c.resumo;
      const esperadoTotal =
        r.dinheiro.saldo_esperado_centavos + FORMAS_CONFERIDAS.filter((f) => f !== "dinheiro").reduce((s, f) => s + r.por_forma[f].saldo_centavos, 0);
      const contado = (f: Exclude<FormaCaixa, "fiado">) => c.conferencia?.[CHAVE_CONFERENCIA[f]] ?? null;
      const totalContado = c.status === "fechado" ? FORMAS_CONFERIDAS.reduce((s, f) => s + (contado(f) ?? 0), 0) : null;
      const status = statusExibicao({
        status: c.status,
        fechamentoConfirmadoNoServidor: true,
        diferenca_total_centavos: c.diferenca_total_centavos,
        conferencia_status: c.conferencia_status,
      });
      const cent = (v: number | null): Celula => (v === null ? null : { centavos: v });
      return [
        c.id.slice(0, 8),
        rotuloTerminal(c.terminal_id, c.terminal_papel),
        formatarDataHoraComSegundos(c.aberto_em),
        c.aberto_por,
        c.fechado_em ? formatarDataHoraComSegundos(c.fechado_em) : "",
        c.fechado_por ?? "",
        ROTULO_STATUS[status],
        cent(r.fundo_inicial_centavos),
        ...FORMAS_CAIXA.map((f) => cent(r.por_forma[f].entradas_centavos)),
        cent(r.total_saidas_centavos),
        cent(r.dinheiro.sangrias_centavos),
        cent(r.dinheiro.suprimentos_centavos),
        cent(r.dinheiro.despesas_centavos),
        cent(r.dinheiro.estornos_centavos),
        cent(esperadoTotal),
        ...FORMAS_CONFERIDAS.map((f) => cent(contado(f))),
        cent(totalContado),
        cent(c.diferenca_dinheiro_centavos),
        cent(c.diferenca_total_centavos),
        c.justificativa_divergencia ?? "",
        c.conferencia_status === "conferido" ? `Conferido${c.conferencia_obs ? `: ${c.conferencia_obs}` : ""}` : c.conferencia_status === "pendente" ? "Pendente" : "",
      ];
    }),
  };
}

export function montarPlanilhas(d: DadosPlanilha): Planilha[] {
  const abas = [abaResumo(d), abaVendas(d), abaItens(d), abaPagamentos(d)];
  if (d.caixas.length > 0) abas.push(abaFechamentos(d.caixas));
  return abas;
}
