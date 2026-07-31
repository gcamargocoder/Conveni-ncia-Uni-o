import { getOfflineDB, FuncionarioLocal } from "./db";

/**
 * Espelho local mínimo de funcionários — necessário para o PIN
 * funcionar offline numa etapa futura. Guardar o pin_hash localmente
 * é um risco de segurança já documentado em OFFLINE_FIRST_ARCHITECTURE.md
 * (seção 8) — aceito conscientemente, não um descuido.
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
