import { getOfflineDB, ClienteLocal } from "./db";

export async function buscarClientesLocalPorTermo(termo: string, limite = 8): Promise<ClienteLocal[]> {
  const termoNormalizado = termo.trim().toLowerCase();
  if (!termoNormalizado) return [];

  const db = getOfflineDB();
  const todos = await db.clientes_local.toArray();

  return todos
    .filter((c) => c.ativo && c.nome.toLowerCase().includes(termoNormalizado))
    .slice(0, limite);
}

export async function buscarClienteLocalPorId(id: string): Promise<ClienteLocal | null> {
  const db = getOfflineDB();
  const cliente = await db.clientes_local.get(id);
  return cliente ?? null;
}