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
  // Mesmas permissões de "caixa" — a diferença entre os dois cargos é
  // só o rótulo (frentista de posto vs. caixa de loja). Nenhuma das
  // permissões extras que "consultar produtos/preços/estoque" pediria
  // é necessária hoje: essas telas já não têm bloqueio de visualização,
  // só as ações de criar/editar/excluir são controladas por permissão.
  frentista: ["pdv.vender"],
};

export function possuiPermissao(cargo: Cargo, permissao: Permissao): boolean {
  return PERMISSOES_POR_CARGO[cargo]?.includes(permissao) ?? false;
}

/**
 * PIN verificável OFFLINE: só para cargos cuja ÚNICA permissão é vender. O verificador
 * (hash) do PIN é copiado para o aparelho, e um PIN de 4 dígitos é quebrável por quem
 * extrair esse dado — por isso nunca se replica o PIN de quem pode mais do que vender
 * (gerente, proprietário, estoquista). Esses cargos validam o PIN no servidor.
 */
export function cargoPodeUsarPinOffline(cargo: string): boolean {
  const permissoes = PERMISSOES_POR_CARGO[cargo as Cargo];
  return Boolean(permissoes) && permissoes.length > 0 && permissoes.every((p) => p === "pdv.vender");
}

export function cargosComPinOffline(): Cargo[] {
  return (Object.keys(PERMISSOES_POR_CARGO) as Cargo[]).filter(cargoPodeUsarPinOffline);
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
  if (cargoAutorizador === "gerente") {
    return cargoAlvo === "caixa" || cargoAlvo === "estoquista" || cargoAlvo === "frentista";
  }
  return false;
}