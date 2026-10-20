import { getOfflineDB, ItemFilaSincronizacao } from "./db";
import { listarPendentes, atualizarStatus, incrementarTentativas, lerPayload } from "./fila-sincronizacao.service";
import { registrarEventoAuditoriaLocal } from "./auditoria-local.service";
import { obterConfiguracao, definirConfiguracao } from "./configuracao-local.service";
import { registrarLog } from "./logs.service";
import { EVENTO_ATUALIZAR_REVISAO } from "@/lib/vendas/eventos";
import { verificarIntegridadeFila } from "./integridade.service";
import { sincronizarVendaAction, PayloadVendaFila, ResultadoSincronizarVenda } from "@/lib/offline-sync/sincronizar-venda-action";

export type FuncaoEnvioVenda = (
  id: string,
  payload: PayloadVendaFila
) => Promise<ResultadoSincronizarVenda>;

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
  /** Vendas que o servidor reteve (revisão do administrador) ou rejeitou: seguem no aparelho, fora do reenvio. */
  retidas: number;
}

/** Um envio que nunca responde (conexão que caiu no meio) não pode prender a venda em "sincronizando". */
export const TEMPO_LIMITE_ENVIO_MS = 30_000;

function comLimiteDeTempo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolver, rejeitar) => {
    const timer = setTimeout(() => rejeitar(new Error("Tempo esgotado ao contatar o servidor")), ms);
    promessa.then(
      (v) => { clearTimeout(timer); resolver(v); },
      (e) => { clearTimeout(timer); rejeitar(e); }
    );
  });
}

/** Quanto tempo um envio pode ficar "sincronizando" antes de ser considerado abandonado (aba fechada, navegador encerrado no meio). */
export const LIMITE_ENVIO_ABANDONADO_MS = 60_000;

/**
 * Uma venda marcada "sincronizando" por uma aba que foi fechada/recarregada no meio do envio não
 * entra mais em listarPendentes e nunca seria reenviada. Devolve-a para "pendente". É seguro: o
 * servidor é idempotente pelo id da venda, então um reenvio nunca duplica.
 */
export async function recuperarEnviosAbandonados(agora = Date.now()): Promise<number> {
  const db = getOfflineDB();
  const presos = await db.fila_sincronizacao.where("status").equals("sincronizando").toArray();
  let recuperados = 0;
  for (const item of presos) {
    const referencia = Date.parse(item.ultima_tentativa_em ?? item.criado_em);
    if (Number.isNaN(referencia) || agora - referencia < LIMITE_ENVIO_ABANDONADO_MS) continue;
    await db.fila_sincronizacao.update(item.id, { status: "pendente" });
    await registrarLog("QUEUE", "aviso", `Envio abandonado recolocado na fila (${item.id})`);
    recuperados++;
  }
  return recuperados;
}

export async function processarFilaSincronizacao(
  enviarVenda: FuncaoEnvioVenda = sincronizarVendaAction,
  tempoLimiteEnvioMs: number = TEMPO_LIMITE_ENVIO_MS
): Promise<ResultadoProcessamentoFila> {
  const inicioMs = Date.now();

  await recuperarEnviosAbandonados();

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
  let retidas = 0;

  for (const item of itens) {
    if (item.tipo !== "venda" || !elegivelParaTentativa(item)) {
      ignorados++;
      continue;
    }

    const resultado = await processarItemVenda(item, enviarVenda, tempoLimiteEnvioMs);
    if (resultado === "requer_login") {
      // Sessão expirada: nenhuma outra venda passaria agora. As vendas seguem
      // guardadas na fila e são enviadas quando alguém entrar de novo.
      falha++;
      break;
    }
    if (resultado === "retida") retidas++;
    else if (resultado === "sucesso") sucesso++;
    else if (resultado === "conflito_resolvido") {
      sucesso++;
      conflitosResolvidos++;
    } else falha++;
  }

  if (retidas > 0 && typeof window !== "undefined") {
    // avisa o menu do administrador (nesta aba) para atualizar a contagem de vendas em revisão
    window.dispatchEvent(new Event(EVENTO_ATUALIZAR_REVISAO));
  }
  await definirConfiguracao(CHAVE_ULTIMA_SINCRONIZACAO_FILA, new Date().toISOString());
  const duracaoMs = Date.now() - inicioMs;

  await registrarEventoAuditoriaLocal("sync_fila_fim", {
    duracao_ms: duracaoMs,
    detalhes: `sucesso=${sucesso} falha=${falha} conflitos=${conflitosResolvidos} ignorados=${ignorados} retidas=${retidas}`,
  });
  await registrarLog(
    "SYNC",
    falha > 0 || retidas > 0 ? "aviso" : "info",
    `Fim do processamento: sucesso=${sucesso} falha=${falha} conflitos=${conflitosResolvidos} ignorados=${ignorados} retidas=${retidas}`,
    `duração=${duracaoMs}ms`
  );

  return { processados: sucesso + falha + retidas, sucesso, falha, conflitosResolvidos, ignoradosPorBackoff: ignorados, retidas };
}

async function processarItemVenda(
  item: ItemFilaSincronizacao,
  enviarVenda: FuncaoEnvioVenda,
  tempoLimiteEnvioMs: number
): Promise<"sucesso" | "conflito_resolvido" | "falha" | "requer_login" | "retida"> {
  await atualizarStatus(item.id, "sincronizando");

  const payload = lerPayload<PayloadVendaFila>(item);
  // Qualquer exceção (rede, resposta inesperada do servidor) vira falha comum:
  // sem isto o item ficaria preso em "sincronizando" e nunca mais seria reenviado.
  let resultado: Awaited<ReturnType<FuncaoEnvioVenda>>;
  try {
    resultado = await comLimiteDeTempo(enviarVenda(item.id, payload), tempoLimiteEnvioMs);
  } catch (e) {
    resultado = { sucesso: false, erro: (e as Error).message || "Falha de comunicação com o servidor" };
  }

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

  if (resultado.requerLogin) {
    // Não é falha da venda: não conta tentativa nem aumenta o atraso (backoff).
    await atualizarStatus(item.id, "pendente", resultado.erro);
    await registrarLog("SYNC", "aviso", "Sincronização pausada: sessão expirada. Entre novamente para enviar as vendas pendentes.");
    return "requer_login";
  }

  if (resultado.retida) {
    // O servidor NÃO gravou a venda, mas a guardou (revisão) ou a recusou de forma definitiva.
    // Ela fica no aparelho, visível, e sai do reenvio automático — nunca é apagada.
    const status = resultado.retida === "em_revisao" ? "em_revisao" : "rejeitada";
    const detalhe = [resultado.erro, ...(resultado.motivos ?? [])].filter(Boolean).join(" — ");
    await db.transaction("rw", db.fila_sincronizacao, db.vendas_locais, async () => {
      await atualizarStatus(item.id, status, detalhe);
      await db.vendas_locais.update(item.id, { status });
    });
    await registrarEventoAuditoriaLocal("sync_item_erro", {
      venda_id: item.id,
      funcionario_id: payload.funcionario_id,
      dispositivo: payload.dispositivo,
      detalhes: `${status}: ${detalhe}`,
    });
    await registrarLog("SYNC", "aviso", `Venda ${item.id} ${status === "em_revisao" ? "retida para revisão do administrador" : "rejeitada"}`, detalhe);
    return "retida";
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