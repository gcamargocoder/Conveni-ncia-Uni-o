import { getOfflineDB, CategoriaLocal } from "./db";

export async function listarCategoriasLocal(): Promise<CategoriaLocal[]> {
  const db = getOfflineDB();
  const todas = await db.categorias_local.toArray();
  return todas.filter((c) => c.ativo).sort((a, b) => a.nome.localeCompare(b.nome));
}

export async function substituirCategoriasLocal(categorias: CategoriaLocal[]): Promise<void> {
  const db = getOfflineDB();
  await db.categorias_local.bulkPut(categorias);
}
