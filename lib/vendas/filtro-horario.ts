import type { Prisma } from "@prisma/client";

/**
 * Filtro de vendas por horário: usa `ocorrido_em` (horário da venda segundo o dispositivo, validado) e, nas vendas
 * antigas que não o têm, `created_at`. Nada é reescrito no banco: a regra vive na consulta.
 * `fim` é exclusivo, a menos que `fimInclusivo` seja informado.
 */
export function vendaNaJanela(inicio: Date, fim: Date, fimInclusivo = false): Prisma.VendaWhereInput {
  const faixa = fimInclusivo ? { gte: inicio, lte: fim } : { gte: inicio, lt: fim };
  return { OR: [{ ocorrido_em: faixa }, { ocorrido_em: null, created_at: faixa }] };
}

/** Ordem aproximada no banco (para o corte `take`); a ordem exata pelo horário efetivo é refeita em memória. */
export const ORDEM_HORARIO_DA_VENDA: Prisma.VendaOrderByWithRelationInput[] = [{ ocorrido_em: { sort: "desc", nulls: "last" } }, { created_at: "desc" }];
