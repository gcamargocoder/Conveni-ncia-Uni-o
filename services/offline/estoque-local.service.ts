import { getOfflineDB, EstoqueLocal } from "./db";

export async function listarEstoqueLocal(): Promise<EstoqueLocal[]> {
  const db = getOfflineDB();
  return db.estoque_local.toArray();
}

export async function obterEstoqueLocalPorProduto(
  produtoId: string
): Promise<EstoqueLocal | undefined> {
  const db = getOfflineDB();
  return db.estoque_local.get(produtoId);
}

export async function substituirEstoqueLocal(estoque: EstoqueLocal[]): Promise<void> {
  const db = getOfflineDB();
  await db.estoque_local.bulkPut(estoque);
}
