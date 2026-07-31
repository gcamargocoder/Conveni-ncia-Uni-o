import { getOfflineDB, ItemFilaSincronizacao } from "./db";
import { registrarLog } from "./logs.service";
import { atualizarStatus } from "./fila-sincronizacao.service";

export interface ProblemaIntegridade {
  itemId: string;
  motivo: string;
}

export async function verificarIntegridadeFila(): Promise<ProblemaIntegridade[]> {
  const db = getOfflineDB();
  const todos = await db.fila_sincronizacao.toArray();
  const problemas: ProblemaIntegridade[] = [];

  for (const item of todos) {
    const motivo = validarItem(item);
    if (!motivo) continue;

    problemas.push({ itemId: item.id, motivo });

    if (item.status !== "erro" || item.erro !== motivo) {
      await atualizarStatus(item.id, "erro", motivo);
    }

    await registrarLog(
      "QUEUE",
      "erro",
      `Item da fila com problema de integridade (${item.id}): ${motivo}`
    );
  }

  return problemas;
}

function validarItem(item: ItemFilaSincronizacao): string | null {
  if (!item.id || typeof item.id !== "string") return "id ausente ou inválido";
  if (isNaN(Date.parse(item.criado_em))) return "timestamp de criação inválido";

  let payload: unknown;
  try {
    payload = JSON.parse(item.payload);
  } catch {
    return "payload não é um JSON válido";
  }

  if (item.tipo === "venda") {
    const p = payload as Record<string, unknown>;
    if (!p.funcionario_id || !p.forma_pagamento || !Array.isArray(p.itens) || p.itens.length === 0) {
      return "payload de venda incompleto (faltam campos obrigatórios)";
    }
  }

  return null;
}