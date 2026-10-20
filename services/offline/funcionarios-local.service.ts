import { getOfflineDB, FuncionarioLocal } from "./db";

/**
 * Espelho local mínimo de funcionários (id, nome, cargo, ativo) — NUNCA com pin_hash.
 * Os verificadores de PIN para o uso offline vivem em credenciais_pin_local e só existem
 * para cargos que apenas vendem (ver INTEGRIDADE_PDV.md).
 */

export async function listarFuncionariosLocal(): Promise<FuncionarioLocal[]> {
  const db = getOfflineDB();
  const todos = await db.funcionarios_local.toArray();
  return todos.filter((f) => f.ativo);
}

export async function substituirFuncionariosLocal(
  funcionarios: FuncionarioLocal[]
): Promise<void> {
  const db = getOfflineDB();
  await db.funcionarios_local.bulkPut(funcionarios);
}

/** Remove um funcionário do espelho local — usado quando o servidor o desativa/remove. */
export async function removerFuncionarioLocal(id: string): Promise<void> {
  const db = getOfflineDB();
  await db.funcionarios_local.delete(id);
}
