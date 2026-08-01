import { BaseEntity } from "./base";

export type Cargo = "proprietario" | "gerente" | "caixa" | "estoquista" | "frentista";

export interface Funcionario extends BaseEntity {
  nome: string;
  cargo: Cargo;
  pin_hash: string; // o PIN nunca é armazenado em texto puro
  ativo: boolean;
}
