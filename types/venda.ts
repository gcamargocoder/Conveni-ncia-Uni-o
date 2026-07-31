import { BaseEntity } from "./base";

export type FormaPagamento = "dinheiro" | "debito" | "credito" | "pix";

export interface ProdutoParaVenda {
  produto_id: string;
  nome: string;
  preco_unitario: number;
  codigo_barras?: string | null;
}

export interface ItemVenda {
  produto_id: string;
  quantidade: number;
  preco_unitario: number; // registrado no momento da venda (histórico)
}

export interface Venda extends BaseEntity {
  funcionario_id: string;
  itens: ItemVenda[];
  forma_pagamento: FormaPagamento;
  total: number;
  cancelada: boolean;
}
