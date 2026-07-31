import { getOfflineDB, EventoSincronizacaoLocal, TipoEventoSincronizacao } from "./db";
import { gerarUuid } from "@/lib/utils/uuid";

export async function registrarEventoSincronizacao(
  tipo: TipoEventoSincronizacao,
  dados?: { registros_atualizados?: number; duracao_ms?: number; detalhes?: string }
): Promise<void> {
  const db = getOfflineDB();
  const evento: EventoSincronizacaoLocal = {
    id: gerarUuid(),
    tipo,
    registros_atualizados: dados?.registros_atualizados ?? null,
    duracao_ms: dados?.duracao_ms ?? null,
    detalhes: dados?.detalhes ?? null,
    timestamp: new Date().toISOString(),
  };
  await db.eventos_sincronizacao.put(evento);
}

export async function listarEventosSincronizacao(limite = 50): Promise<EventoSincronizacaoLocal[]> {
  const db = getOfflineDB();
  return db.eventos_sincronizacao.orderBy("timestamp").reverse().limit(limite).toArray();
}