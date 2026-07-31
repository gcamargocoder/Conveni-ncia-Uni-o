import { getOfflineDB, EventoAuditoriaLocal, TipoEventoAuditoriaLocal } from "./db";
import { gerarUuid } from "@/lib/utils/uuid";

export async function registrarEventoAuditoriaLocal(
  tipo: TipoEventoAuditoriaLocal,
  dados?: {
    venda_id?: string;
    funcionario_id?: string;
    dispositivo?: string;
    duracao_ms?: number;
    detalhes?: string;
  }
): Promise<void> {
  const db = getOfflineDB();
  const evento: EventoAuditoriaLocal = {
    id: gerarUuid(),
    tipo,
    venda_id: dados?.venda_id ?? null,
    funcionario_id: dados?.funcionario_id ?? null,
    dispositivo: dados?.dispositivo ?? null,
    duracao_ms: dados?.duracao_ms ?? null,
    detalhes: dados?.detalhes ?? null,
    timestamp: new Date().toISOString(),
  };
  await db.auditoria_local.put(evento);
}

export async function listarAuditoriaLocal(limite = 100): Promise<EventoAuditoriaLocal[]> {
  const db = getOfflineDB();
  return db.auditoria_local.orderBy("timestamp").reverse().limit(limite).toArray();
}

/**
 * Conta quantas vendas foram sincronizadas via idempotência (já
 * existiam no servidor) — o worker registra isso no campo `detalhes`
 * do evento "sync_item_sucesso" (ver worker-sincronizacao.service.ts).
 */
export async function contarConflitosResolvidos(): Promise<number> {
  const db = getOfflineDB();
  const eventos = await db.auditoria_local.where("tipo").equals("sync_item_sucesso").toArray();
  return eventos.filter((e) => e.detalhes?.includes("conflito resolvido")).length;
}