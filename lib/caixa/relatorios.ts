import { formatarDataHoraComSegundos } from "@/lib/utils/fuso";
import { FORMAS_CAIXA, ROTULO_FORMA, ROTULO_TIPO, type FormaCaixa, type TipoMovimento } from "./tipos";

/**
 * Relatórios do caixa — derivados de UM conjunto (caixas + movimentos) por funções puras, em centavos.
 * Os tipos abaixo são o formato mínimo que o servidor devolve (ver services/caixa-consulta.service.ts).
 */

export interface MovimentoRel {
  id: string;
  caixa_id: string;
  tipo: TipoMovimento;
  sentido: "entrada" | "saida";
  forma_pagamento: FormaCaixa;
  valor_centavos: number;
  funcionario_id: string;
  funcionario_nome: string;
  dispositivo: string;
  origem: "online" | "offline";
  estorno_de_id: string | null;
  descricao: string | null;
  justificativa: string | null;
  ocorrido_em: string;
}

export interface CaixaRel {
  id: string;
  terminal_id: string;
  terminal_papel: string | null;
  status: "aberto" | "fechado";
  aberto_em: string;
  fechado_em: string | null;
  aberto_por: string;
  fechado_por: string | null;
  fundo_inicial_centavos: number;
  diferenca_dinheiro_centavos: number | null;
  diferenca_total_centavos: number | null;
  justificativa_divergencia: string | null;
  conferencia_status: "pendente" | "conferido" | null;
  resumo: { total_vendas_centavos: number; total_recebido_centavos: number; dinheiro: { saldo_esperado_centavos: number } };
}

export type TotaisPorForma = Record<FormaCaixa, number>;
const zeros = (): TotaisPorForma => Object.fromEntries(FORMAS_CAIXA.map((f) => [f, 0])) as TotaisPorForma;

/** Vendas por forma de pagamento, descontados os estornos de venda. */
export function vendasPorForma(movs: MovimentoRel[]): TotaisPorForma {
  const porId = new Map(movs.map((m) => [m.id, m]));
  const total = zeros();
  for (const m of movs) {
    if (m.tipo === "venda") total[m.forma_pagamento] += m.valor_centavos;
    else if (m.tipo === "estorno" && m.estorno_de_id && porId.get(m.estorno_de_id)?.tipo === "venda") total[m.forma_pagamento] -= m.valor_centavos;
  }
  return total;
}

export interface LinhaOperador {
  funcionario_id: string;
  funcionario_nome: string;
  vendas_centavos: number;
  quantidade_operacoes: number;
  por_forma: TotaisPorForma;
  sangrias_centavos: number;
  suprimentos_centavos: number;
  despesas_centavos: number;
  estornos_centavos: number;
}

/** Fechamento por operador: tudo o que cada funcionário (identificado pelo PIN) movimentou. */
export function porOperador(movs: MovimentoRel[]): LinhaOperador[] {
  const mapa = new Map<string, LinhaOperador>();
  for (const m of movs) {
    const l =
      mapa.get(m.funcionario_id) ??
      ({
        funcionario_id: m.funcionario_id,
        funcionario_nome: m.funcionario_nome,
        vendas_centavos: 0,
        quantidade_operacoes: 0,
        por_forma: zeros(),
        sangrias_centavos: 0,
        suprimentos_centavos: 0,
        despesas_centavos: 0,
        estornos_centavos: 0,
      } satisfies LinhaOperador);
    l.quantidade_operacoes++;
    if (m.tipo === "venda") {
      l.vendas_centavos += m.valor_centavos;
      l.por_forma[m.forma_pagamento] += m.valor_centavos;
    } else if (m.tipo === "sangria") l.sangrias_centavos += m.valor_centavos;
    else if (m.tipo === "suprimento") l.suprimentos_centavos += m.valor_centavos;
    else if (m.tipo === "despesa") l.despesas_centavos += m.valor_centavos;
    else if (m.tipo === "estorno") l.estornos_centavos += m.valor_centavos;
    mapa.set(m.funcionario_id, l);
  }
  return [...mapa.values()].sort((a, b) => a.funcionario_nome.localeCompare(b.funcionario_nome));
}

export interface LinhaTerminal {
  terminal_id: string;
  terminal_papel: string | null;
  caixas: number;
  abertos: number;
  fechados: number;
  vendas_centavos: number;
  recebido_centavos: number;
  diferenca_total_centavos: number;
  com_divergencia: number;
}

export function porTerminal(caixas: CaixaRel[]): LinhaTerminal[] {
  const mapa = new Map<string, LinhaTerminal>();
  for (const c of caixas) {
    const l =
      mapa.get(c.terminal_id) ??
      ({
        terminal_id: c.terminal_id,
        terminal_papel: c.terminal_papel,
        caixas: 0,
        abertos: 0,
        fechados: 0,
        vendas_centavos: 0,
        recebido_centavos: 0,
        diferenca_total_centavos: 0,
        com_divergencia: 0,
      } satisfies LinhaTerminal);
    l.caixas++;
    if (c.status === "aberto") l.abertos++;
    else l.fechados++;
    l.vendas_centavos += c.resumo.total_vendas_centavos;
    l.recebido_centavos += c.resumo.total_recebido_centavos;
    l.diferenca_total_centavos += c.diferenca_total_centavos ?? 0;
    if ((c.diferenca_total_centavos ?? 0) !== 0) l.com_divergencia++;
    mapa.set(c.terminal_id, l);
  }
  return [...mapa.values()];
}

export const sangriasESuprimentos = (movs: MovimentoRel[]) => movs.filter((m) => m.tipo === "sangria" || m.tipo === "suprimento");
export const despesasDoCaixa = (movs: MovimentoRel[]) => movs.filter((m) => m.tipo === "despesa");
export const divergencias = (caixas: CaixaRel[]) => caixas.filter((c) => (c.diferenca_total_centavos ?? 0) !== 0);

// ---------------------------------------------------------------------------
// Exportação CSV (UTF-8 com BOM, separador ";" — abre direto no Excel em português)
// ---------------------------------------------------------------------------

export const centavosParaDecimal = (c: number) => (c / 100).toFixed(2).replace(".", ",");

function celula(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  // Protege contra injeção de fórmula em planilhas (= + - @) e escapa aspas/separadores.
  const seguro = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

export function paraCsv(linhas: (string | number | null | undefined)[][]): string {
  return "﻿" + linhas.map((l) => l.map(celula).join(";")).join("\r\n");
}

export function csvMovimentos(movs: MovimentoRel[]): string {
  return paraCsv([
    ["Data/hora", "Caixa", "Tipo", "Sentido", "Forma", "Valor (R$)", "Funcionário", "Terminal", "Origem", "Descrição/Justificativa"],
    ...movs.map((m) => [
      formatarDataHoraComSegundos(m.ocorrido_em),
      m.caixa_id,
      ROTULO_TIPO[m.tipo],
      m.sentido,
      ROTULO_FORMA[m.forma_pagamento],
      centavosParaDecimal(m.valor_centavos),
      m.funcionario_nome,
      m.dispositivo,
      m.origem,
      m.justificativa ?? m.descricao ?? "",
    ]),
  ]);
}

export function csvCaixas(caixas: CaixaRel[]): string {
  return paraCsv([
    ["Caixa", "Terminal", "Status", "Aberto em", "Aberto por", "Fechado em", "Fechado por", "Fundo (R$)", "Vendas (R$)", "Recebido (R$)", "Dinheiro esperado (R$)", "Diferença total (R$)", "Justificativa"],
    ...caixas.map((c) => [
      c.id,
      c.terminal_id,
      c.status,
      formatarDataHoraComSegundos(c.aberto_em),
      c.aberto_por,
      c.fechado_em ? formatarDataHoraComSegundos(c.fechado_em) : "",
      c.fechado_por ?? "",
      centavosParaDecimal(c.fundo_inicial_centavos),
      centavosParaDecimal(c.resumo.total_vendas_centavos),
      centavosParaDecimal(c.resumo.total_recebido_centavos),
      centavosParaDecimal(c.resumo.dinheiro.saldo_esperado_centavos),
      c.diferenca_total_centavos == null ? "" : centavosParaDecimal(c.diferenca_total_centavos),
      c.justificativa_divergencia ?? "",
    ]),
  ]);
}
