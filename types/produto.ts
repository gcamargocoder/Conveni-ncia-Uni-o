import { BaseEntity } from "./base";

export interface Produto extends BaseEntity {
  nome: string;
  categoria_id: string;
  fornecedor_id: string | null;
  codigo_barras: string | null;
  descricao: string | null;
  preco_venda: number;
  preco_custo: number;
  estoque_minimo: number;
  unidade: "un" | "kg" | "l";
  ativo: boolean;
}

export interface Categoria extends BaseEntity {
  nome: string;
  ativo: boolean;
}

export interface Fornecedor extends BaseEntity {
  nome: string;
  telefone: string | null;
  cnpj_cpf: string | null;
  ativo: boolean;
}
