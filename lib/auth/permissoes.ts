import { Cargo } from "@/types/funcionario";

/**
 * Cada operação sensível do sistema é uma "permissão" aqui.
 * As telas nunca decidem sozinhas quem pode fazer o quê — elas
 * perguntam para esta regra. Isso evita que a mesma checagem seja
 * copiada e colada (e esquecida) em vários componentes.
 */
export type Permissao =
  | "pdv.vender"
  | "pdv.cancelar_venda"
  | "estoque.entrada"
  | "estoque.ajuste"
  | "produtos.editar"
  | "funcionarios.gerenciar"
  | "relatorios.visualizar";

const PERMISSOES_POR_CARGO: Record<Cargo, Permissao[]> = {
  proprietario: [
    "pdv.vender",
    "pdv.cancelar_venda",
    "estoque.entrada",
    "estoque.ajuste",
    "produtos.editar",
    "funcionarios.gerenciar",
    "relatorios.visualizar",
  ],
  gerente: [
    "pdv.vender",
    "pdv.cancelar_venda",
    "estoque.entrada",
    "estoque.ajuste",
    "produtos.editar",
    "relatorios.visualizar",
  ],
  caixa: ["pdv.vender"],
  estoquista: ["estoque.entrada", "estoque.ajuste"],
};

export function possuiPermissao(cargo: Cargo, permissao: Permissao): boolean {
  return PERMISSOES_POR_CARGO[cargo]?.includes(permissao) ?? false;
}
