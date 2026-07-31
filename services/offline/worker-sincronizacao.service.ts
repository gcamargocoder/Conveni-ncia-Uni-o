import { getOfflineDB, ItemFilaSincronizacao } from "./db";
import { listarPendentes, atualizarStatus, incrementarTentativas, lerPayload } from "./fila-sincronizacao.service";
import { registrarEventoAuditoriaLocal } from "./auditoria-local.service";
import { obterConfiguracao, definirConfiguracao } from "./configuracao-local.service";
import { registrarLog } from "./logs.service";
import { verificarIntegridadeFila } from "./integridade.service";
import { sincronizarVendaAction, PayloadVendaFila } from "@/lib/offline-sync/sincronizar-venda-action";

export type FuncaoEnvioVenda = (
  id: string,
  payload: PayloadVendaFila
) => Promise<{ sucesso: boolean; jaExistia?: boolean; erro?: string }>;

const DEGRAUS_BACKOFF_MS = [2000, 5000, 10000, 30000, 60000, 300000];
const CHAVE_ULTIMA_SINCRONIZACAO_FILA = "ultima_sincronizacao_fila";

export function calcularAtrasoBackoff(tentativas: number): number {
  if (tentativas <= 0) return 0;
  const indice = Math.min(tentativas - 1, DEGRAUS_BACKOFF_MS.length - 1);
  return DEGRAUS_BACKOFF_MS[indice];
}

export function elegivelParaTentativa(item: ItemFilaSincronizacao, agora = Date.now()): boolean {
  if (item.tentativas === 0 || !item.ultima_tentativa_em) return true;
  const proximaElegivel = new Date(item.ultima_tentativa_em).getTime() + calcularAtrasoBackoff(item.tentativas);
  return agora >= proximaElegivel;
}

export interface ResultadoProcessamentoFila {
  processados: number;
  sucesso: number;
  falha: number;
  conflitosResolvidos: number;
  ignoradosPorBackoff: number;
}

export async function processarFilaSincronizacao(
  enviarVenda: FuncaoEnvioVenda = sincronizarVendaAction
): Promise<ResultadoProcessamentoFila> {
  const inicioMs = Date.now();

  const problemasIntegridade = await verificarIntegridadeFila();
  if (problemasIntegridade.length > 0) {
    await registrarLog(
      "QUEUE",
      "aviso",
      `${problemasIntegridade.length} item(ns) com problema de integridade foram marcados como erro`
    );
  }

  const itens = await listarPendentes();

  await registrarEventoAuditoriaLocal("sync_fila_inicio", {
    detalhes: `${itens.length} item(ns) na fila`,
  });
  await registrarLog("SYNC", "info", `Início do processamento da fila: ${itens.length} item(ns)`);

  let sucesso = 0;
  let falha = 0;
  let conflitosResolvidos = 0;
  let ignorados = 0;

  for (const item of itens) {
    if (item.tipo !== "venda" || !elegivelParaTentativa(item)) {
      ignorados++;
      continue;
    }

    const resultado = await processarItemVenda(item, enviarVenda);
    if (resultado === "sucesso") sucesso++;
    else if (resultado === "conflito_resolvido") {
      sucesso++;
      conflitosResolvidos++;
    } else falha++;
  }

  await definirConfiguracao(CHAVE_ULTIMA_SINCRONIZACAO_FILA, new Date().toISOString());
  const duracaoMs = Date.now() - inicioMs;

  await registrarEventoAuditoriaLocal("sync_fila_fim", {
    duracao_ms: duracaoMs,
    detalhes: `sucesso=${sucesso} falha=${falha} conflitos=${conflitosResolvidos} ignorados=${ignorados}`,
  });
  await registrarLog(
    "SYNC",
    falha > 0 ? "aviso" : "info",
    `Fim do processamento: sucesso=${sucesso} falha=${falha} conflitos=${conflitosResolvidos} ignorados=${ignorados}`,
    `duração=${duracaoMs}ms`
  );

  return { processados: sucesso + falha, sucesso, falha, conflitosResolvidos, ignoradosPorBackoff: ignorados };
}

async function processarItemVenda(
  item: ItemFilaSincronizacao,
  enviarVenda: FuncaoEnvioVenda
): Promise<"sucesso" | "conflito_resolvido" | "falha"> {
  await atualizarStatus(item.id, "sincronizando");

  const payload = lerPayload<PayloadVendaFila>(item);
  const resultado = await enviarVenda(item.id, payload);

  const db = getOfflineDB();

  if (resultado.sucesso) {
    await db.transaction("rw", db.fila_sincronizacao, db.vendas_locais, async () => {
      await db.fila_sincronizacao.update(item.id, {
        status: "sincronizado",
        ultima_tentativa_em: new Date().toISOString(),
        erro: null,
      });
      await db.vendas_locais.update(item.id, { status: "sincronizada" });
    });

    if (resultado.jaExistia) {
      await registrarEventoAuditoriaLocal("sync_item_sucesso", {
        venda_id: item.id,
        funcionario_id: payload.funcionario_id,
        dispositivo: payload.dispositivo,
        detalhes: "conflito resolvido: venda já existia no servidor (idempotência)",
      });
      await registrarLog("SYNC", "aviso", `Conflito resolvido para venda ${item.id}: já existia no servidor`);
      return "conflito_resolvido";
    }

    await registrarEventoAuditoriaLocal("sync_item_sucesso", {
      venda_id: item.id,
      funcionario_id: payload.funcionario_id,
      dispositivo: payload.dispositivo,
    });
    return "sucesso";
  }

  await incrementarTentativas(item.id);
  await atualizarStatus(item.id, "erro", resultado.erro);
  await registrarEventoAuditoriaLocal("sync_item_erro", {
    venda_id: item.id,
    funcionario_id: payload.funcionario_id,
    dispositivo: payload.dispositivo,
    detalhes: resultado.erro,
  });
  await registrarLog("SYNC", "erro", `Falha ao sincronizar venda ${item.id}`, resultado.erro);
  return "falha";
}

export async function obterUltimaSincronizacaoFila(): Promise<string | null> {
  return (await obterConfiguracao(CHAVE_ULTIMA_SINCRONIZACAO_FILA)) ?? null;
}