import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";
import type { Prisma } from "@prisma/client";
import { janelaDoFiltro, type FiltroVendas } from "@/lib/relatorios/filtro";
import type { FormaCaixa } from "@/lib/caixa/tipos";

export interface VendaRelatorio {
  id: string;
  created_at: string;
  total: number;
  forma_pagamento: string;
  cancelada: boolean;
}

export interface ResumoPorFormaPagamento {
  forma_pagamento: string;
  quantidade: number;
  total: number;
}

const LIMITE_VENDAS_RELATORIO = 1000;

export async function listarVendasPorPeriodo(inicio: Date, fim: Date): Promise<VendaRelatorio[]> {
  return executar(
    () =>
      prisma.venda.findMany({
        select: { id: true, created_at: true, total: true, forma_pagamento: true, cancelada: true },
        where: { created_at: { gte: inicio, lte: fim } },
        orderBy: { created_at: "desc" },
        take: LIMITE_VENDAS_RELATORIO,
      }),
    "Erro ao listar vendas"
  );
}

export function resumirPorFormaPagamento(vendas: VendaRelatorio[]): ResumoPorFormaPagamento[] {
  const mapa = new Map<string, ResumoPorFormaPagamento>();

  for (const v of vendas) {
    if (v.cancelada) continue; // venda cancelada não entra no faturamento
    const atual = mapa.get(v.forma_pagamento) ?? {
      forma_pagamento: v.forma_pagamento,
      quantidade: 0,
      total: 0,
    };
    atual.quantidade += 1;
    atual.total += v.total;
    mapa.set(v.forma_pagamento, atual);
  }

  return Array.from(mapa.values()).sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// Consulta detalhada (tela e exportação Excel usam EXATAMENTE a mesma função)
// ---------------------------------------------------------------------------

export interface PagamentoDaVenda {
  forma: FormaCaixa;
  valor_centavos: number;
}

export interface VendaDetalhada {
  id: string;
  created_at: string;
  total: number;
  total_centavos: number;
  /** "misto" quando houve pagamento dividido. */
  forma_pagamento: string;
  cancelada: boolean;
  funcionario_nome: string;
  caixa_id: string | null;
  terminal_id: string | null;
  terminal_papel: string | null;
  itens: { produto: string; quantidade: number; preco_unitario: number; subtotal_centavos: number }[];
  /** Uma linha por forma de pagamento; a soma é o total da venda (sem duplicar pagamento misto). */
  pagamentos: PagamentoDaVenda[];
  /** true = venda sem lançamento de caixa (legada): o pagamento foi inferido do cabeçalho da venda. */
  pagamento_inferido: boolean;
}

export interface ResultadoVendasDetalhadas {
  vendas: VendaDetalhada[];
  truncado: boolean;
}

export const LIMITE_TELA = 1000;
export const LIMITE_EXPORTACAO = 20000;

export function montarWhereVendas(f: FiltroVendas): Prisma.VendaWhereInput {
  const { inicio, fim } = janelaDoFiltro(f);
  const e: Prisma.VendaWhereInput[] = [{ created_at: { gte: inicio, lt: fim } }];
  if (f.funcionario_id) e.push({ funcionario_id: f.funcionario_id });
  if (f.situacao === "ativas") e.push({ cancelada: false });
  if (f.situacao === "canceladas") e.push({ cancelada: true });
  if (f.terminal_id) e.push({ movimentos_caixa: { some: { tipo: "venda", caixa: { terminal_id: f.terminal_id } } } });
  if (f.caixa_id) e.push({ movimentos_caixa: { some: { tipo: "venda", caixa_id: f.caixa_id } } });
  if (f.forma) {
    // Venda dividida entra pelo pagamento que tiver a forma; venda legada, pelo cabeçalho.
    e.push({ OR: [{ forma_pagamento: f.forma }, { movimentos_caixa: { some: { tipo: "venda", forma_pagamento: f.forma } } }] });
  }
  return { AND: e };
}

interface LinhaBruta {
  id: string;
  created_at: string;
  total: number;
  forma_pagamento: string;
  cancelada: boolean;
  funcionario: { nome: string };
  itens: { quantidade: number; preco_unitario: number; produto: { nome: string } }[];
  movimentos_caixa: { forma_pagamento: string; valor_centavos: number; ordem: number | null; caixa_id: string; caixa: { terminal_id: string; terminal_papel: string | null } }[];
}

const emCentavos = (v: number) => Math.round(v * 100);

export function paraVendaDetalhada(l: LinhaBruta): VendaDetalhada {
  const lancamentos = [...l.movimentos_caixa].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const inferido = lancamentos.length === 0;
  const total_centavos = emCentavos(l.total);
  const pagamentos: PagamentoDaVenda[] = inferido
    ? [{ forma: (l.forma_pagamento === "misto" ? "dinheiro" : l.forma_pagamento) as FormaCaixa, valor_centavos: total_centavos }]
    : lancamentos.map((m) => ({ forma: m.forma_pagamento as FormaCaixa, valor_centavos: m.valor_centavos }));
  const primeiro = lancamentos[0];
  return {
    id: l.id,
    created_at: l.created_at,
    total: l.total,
    total_centavos,
    forma_pagamento: l.forma_pagamento,
    cancelada: l.cancelada,
    funcionario_nome: l.funcionario.nome,
    caixa_id: primeiro?.caixa_id ?? null,
    terminal_id: primeiro?.caixa.terminal_id ?? null,
    terminal_papel: primeiro?.caixa.terminal_papel ?? null,
    itens: l.itens.map((i) => ({
      produto: i.produto.nome,
      quantidade: i.quantidade,
      preco_unitario: i.preco_unitario,
      subtotal_centavos: Math.round(i.quantidade * i.preco_unitario * 100),
    })),
    pagamentos,
    pagamento_inferido: inferido,
  };
}

export async function listarVendasDetalhadas(filtro: FiltroVendas, limite = LIMITE_TELA): Promise<ResultadoVendasDetalhadas> {
  const linhas = await executar<LinhaBruta[]>(
    () =>
      prisma.venda.findMany({
        where: montarWhereVendas(filtro),
        orderBy: { created_at: "desc" },
        take: limite + 1,
        select: {
          id: true,
          created_at: true,
          total: true,
          forma_pagamento: true,
          cancelada: true,
          funcionario: { select: { nome: true } },
          itens: { select: { quantidade: true, preco_unitario: true, produto: { select: { nome: true } } } },
          movimentos_caixa: {
            where: { tipo: "venda" },
            select: { forma_pagamento: true, valor_centavos: true, ordem: true, caixa_id: true, caixa: { select: { terminal_id: true, terminal_papel: true } } },
          },
        },
      }),
    "Erro ao listar vendas"
  );
  const truncado = linhas.length > limite;
  return { vendas: linhas.slice(0, limite).map(paraVendaDetalhada), truncado };
}

export interface LinhaResumoForma {
  forma: FormaCaixa;
  quantidade_vendas: number;
  total_centavos: number;
}

/**
 * Faturamento por forma, a partir dos PAGAMENTOS (não do cabeçalho da venda): venda dividida entra em cada
 * forma com o valor de cada parte, e a soma de todas as formas é igual à soma dos totais das vendas válidas.
 * Com filtro de forma, só as partes dessa forma.
 */
export function resumirPagamentos(vendas: VendaDetalhada[], forma: FormaCaixa | null = null): LinhaResumoForma[] {
  const mapa = new Map<FormaCaixa, { vendas: Set<string>; total: number }>();
  for (const v of vendas) {
    if (v.cancelada) continue;
    for (const p of v.pagamentos) {
      if (forma && p.forma !== forma) continue;
      const atual = mapa.get(p.forma) ?? { vendas: new Set<string>(), total: 0 };
      atual.vendas.add(v.id);
      atual.total += p.valor_centavos;
      mapa.set(p.forma, atual);
    }
  }
  return [...mapa.entries()]
    .map(([f, x]) => ({ forma: f, quantidade_vendas: x.vendas.size, total_centavos: x.total }))
    .sort((a, b) => b.total_centavos - a.total_centavos);
}

export interface TurnoParaFiltro {
  id: string;
  terminal_id: string;
  terminal_papel: string | null;
  aberto_em: string;
  fechado_em: string | null;
  aberto_por: string;
}

/** Turnos (caixas) recentes para o seletor do filtro. Leve: não calcula resumo. */
export async function listarTurnosParaFiltro(limite = 60): Promise<TurnoParaFiltro[]> {
  const linhas = await executar<(Omit<TurnoParaFiltro, "aberto_por"> & { aberto_por_funcionario: { nome: string } })[]>(
    () =>
      prisma.caixa.findMany({
        orderBy: { aberto_em: "desc" },
        take: limite,
        select: { id: true, terminal_id: true, terminal_papel: true, aberto_em: true, fechado_em: true, aberto_por_funcionario: { select: { nome: true } } },
      }),
    "Erro ao listar turnos"
  );
  return linhas.map(({ aberto_por_funcionario, ...resto }) => ({ ...resto, aberto_por: aberto_por_funcionario.nome }));
}
