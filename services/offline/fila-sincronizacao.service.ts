import { getOfflineDB, ItemFilaSincronizacao, TipoOperacaoFila, StatusFila } from "./db";

export async function enfileirar(
  id: string,
  tipo: TipoOperacaoFila,
  payload: unknown
): Promise<void> {
  const db = getOfflineDB();
  const item: ItemFilaSincronizacao = {
    id,
    tipo,
    payload: JSON.stringify(payload),
    status: "pendente",
    tentativas: 0,
    criado_em: new Date().toISOString(),
    ultima_tentativa_em: null,
    erro: null,
  };
  await db.fila_sincronizacao.put(item);
}

export async function listarPendentes(): Promise<ItemFilaSincronizacao[]> {
  const db = getOfflineDB();
  return db.fila_sincronizacao
    .where("status")
    .anyOf("pendente", "erro")
    .sortBy("criado_em");
}

export async function contarPendentes(): Promise<number> {
  const db = getOfflineDB();
  return db.fila_sincronizacao.where("status").anyOf("pendente", "erro").count();
}

/** Só os que falharam de verdade (já tentou e não conseguiu) — distinto de "pendente aguardando a primeira tentativa". */
export async function contarComErro(): Promise<number> {
  const db = getOfflineDB();
  return db.fila_sincronizacao.where("status").equals("erro").count();
}

export async function contarSincronizados(): Promise<number> {
  const db = getOfflineDB();
  return db.fila_sincronizacao.where("status").equals("sincronizado").count();
}

export async function atualizarStatus(
  id: string,
  status: StatusFila,
  erro?: string
): Promise<void> {
  const db = getOfflineDB();
  await db.fila_sincronizacao.update(id, {
    status,
    ultima_tentativa_em: new Date().toISOString(),
    erro: erro ?? null,
  });
}

export async function incrementarTentativas(id: string): Promise<void> {
  const db = getOfflineDB();
  const item = await db.fila_sincronizacao.get(id);
  if (!item) return;
  await db.fila_sincronizacao.update(id, { tentativas: item.tentativas + 1 });
}

export async function removerDaFila(id: string): Promise<void> {
  const db = getOfflineDB();
  await db.fila_sincronizacao.delete(id);
}

/** Desserializa o payload de um item da fila, tipado pelo chamador. */
export function lerPayload<T>(item: ItemFilaSincronizacao): T {
  return JSON.parse(item.payload) as T;
}