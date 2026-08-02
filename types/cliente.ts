import { BaseEntity } from "./base";

export interface Cliente extends BaseEntity {
  nome: string;
  telefone: string | null;
  cpf: string | null;
  endereco: string | null;
  observacoes: string | null;
  ativo: boolean;
}