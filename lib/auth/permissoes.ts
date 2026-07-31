import { Cargo } from "@/types/funcionario";

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

/**
 * Hierarquia de quem pode editar/excluir quem — diferente de
 * "funcionarios.gerenciar" (usada só para CRIAR, hoje restrita ao
 * proprietário). Editar/excluir segue uma regra de hierarquia própria:
 * o proprietário gerencia todo mundo; o gerente gerencia caixa e
 * estoquista, mas nunca outro gerente nem o proprietário; caixa e
 * estoquista não gerenciam ninguém.
 */
export function podeGerenciarFuncionario(cargoAutorizador: Cargo, cargoAlvo: Cargo): boolean {
  if (cargoAutorizador === "proprietario") return true;
  if (cargoAutorizador === "gerente") return cargoAlvo === "caixa" || cargoAlvo === "estoquista";
  return false;
}