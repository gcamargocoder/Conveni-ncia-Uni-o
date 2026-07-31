"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { contarPendentes, contarComErro, contarSincronizados, listarPendentes } from "@/services/offline/fila-sincronizacao.service";
import { contarConflitosResolvidos, listarAuditoriaLocal } from "@/services/offline/auditoria-local.service";
import { obterUltimaSincronizacaoFila } from "@/services/offline/worker-sincronizacao.service";
import { useStatusSincronizacaoCatalogo } from "./useStatusSincronizacaoCatalogo";
import { useConectividade } from "./useConectividade";
import { useTempoConectividade } from "./useTempoConectividade";
import type { ItemFilaSincronizacao, EventoAuditoriaLocal } from "@/services/offline/db";

export interface DadosDashboardSincronizacao {
  pendentes: number;
  comErro: number;
  sincronizados: number;
  conflitosResolvidos: number;
  ultimaSincronizacaoFila: string | null;
  filaAtual: ItemFilaSincronizacao[];
  ultimosEventos: EventoAuditoriaLocal[];
}

export function useDashboardSincronizacao() {
  const status = useConectividade();
  const tempoConectividade = useTempoConectividade();
  const statusCatalogo = useStatusSincronizacaoCatalogo();

  const dados = useLiveQuery<DadosDashboardSincronizacao | undefined>(async () => {
    if (typeof indexedDB === "undefined") return undefined;

    const [pendentes, comErro, sincronizados, conflitosResolvidos, ultimaSincronizacaoFila, filaAtual, ultimosEventos] =
      await Promise.all([
        contarPendentes(),
        contarComErro(),
        contarSincronizados(),
        contarConflitosResolvidos(),
        obterUltimaSincronizacaoFila(),
        listarPendentes(),
        listarAuditoriaLocal(20),
      ]);

    return { pendentes, comErro, sincronizados, conflitosResolvidos, ultimaSincronizacaoFila, filaAtual, ultimosEventos };
  }, []);

  return { status, tempoConectividade, statusCatalogo, dados };
}