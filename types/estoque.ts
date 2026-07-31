import { BaseEntity } from "./base";

export type TipoMovimentacao =
  | "entrada"
  | "venda"
  | "perda"
  | "ajuste_entrada"
  | "ajuste_saida"
  | "inventario"
  | "consumo_interno";

/**
 * Toda alteração de estoque nasce de uma movimentação — nunca alteramos
 * a quantidade de um produto diretamente. Isso garante rastreabilidade
 * completa (princípio do documento mestre).
 */
export interface MovimentacaoEstoque extends BaseEntity {
  produto_id: string;
  tipo: TipoMovimentacao;
  quantidade: number; // sempre positiva; o `tipo` define se soma ou subtrai
  funcionario_id: string;
  observacao: string | null;
  venda_id: string | null; // preenchido quando tipo === "venda"
}
