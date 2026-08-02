import { BaseEntity } from "./base";

export type FormaPagamento = "dinheiro" | "debito" | "credito" | "pix" | "fiado";

export interface ProdutoParaVenda {
  produto_id: string;
  nome: string;
  preco_unitario: number;
  codigo_barras?: string | null;
}

export interface ItemVenda {
  produto_id: string;
  quantidade: number;
  preco_unitario: number;
}

export interface Venda extends BaseEntity {
  funcionario_id: string;
  itens: ItemVenda[];
  forma_pagamento: FormaPagamento;
  total: number;
  cancelada: boolean;
}