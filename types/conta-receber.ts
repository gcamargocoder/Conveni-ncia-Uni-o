export type StatusConta = "ABERTA" | "PARCIAL" | "QUITADA";

export interface ContaReceber {
  id: string;
  cliente_id: string;
  venda_id: string;
  valor_original: number;
  saldo_atual: number;
  status: StatusConta;
  created_at: string;
  updated_at: string;
}

export interface Recebimento {
  id: string;
  conta_receber_id: string;
  valor: number;
  forma_pagamento: string;
  observacoes: string | null;
  funcionario_id: string;
  created_at: string;
}

export interface ContaReceberComCliente extends ContaReceber {
  cliente_nome: string;
  cliente_telefone: string | null;
  venda_created_at: string;
}