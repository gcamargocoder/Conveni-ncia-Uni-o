"use client";

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  listarCaixasLocais,
  atualizarRecebimentosDoServidor,
  listarMovimentosLocais,
  obterCaixaAbertoLocal,
  pendenciasDoCaixa,
  resumoLocal,
  type PendenciasCaixa,
} from "@/services/offline/caixa-local.service";
import type { CaixaLocal, MovimentoCaixaLocal } from "@/services/offline/db";
import type { ResumoCaixa } from "@/lib/caixa/tipos";

export interface EstadoCaixaLocal {
  carregando: boolean;
  caixa: CaixaLocal | null;
  movimentos: MovimentoCaixaLocal[];
  resumo: ResumoCaixa | null;
  pendencias: PendenciasCaixa;
  /** Último caixa fechado deste terminal — para exibir o estado do fechamento (confirmado ou pendente). */
  ultimoFechado: CaixaLocal | null;
}

const VAZIO: EstadoCaixaLocal = {
  carregando: true,
  caixa: null,
  movimentos: [],
  resumo: null,
  pendencias: { aguardando: 0, retidas: 0 },
  ultimoFechado: null,
};

/**
 * Estado do caixa DESTE terminal, lido do IndexedDB e atualizado ao vivo (useLiveQuery reexecuta quando
 * qualquer tabela consultada muda, inclusive quando o worker sincroniza). Funciona sem internet.
 */
export function useCaixaLocal(): EstadoCaixaLocal {
  const estado = useLiveQuery(async (): Promise<EstadoCaixaLocal> => {
    if (typeof indexedDB === "undefined") return { ...VAZIO, carregando: false };
    const caixa = (await obterCaixaAbertoLocal()) ?? null;
    const recentes = await listarCaixasLocais(5);
    const ultimoFechado = recentes.find((c) => c.status === "fechado") ?? null;
    if (!caixa) return { ...VAZIO, carregando: false, ultimoFechado };
    const [movimentos, resumo, pendencias] = await Promise.all([
      listarMovimentosLocais(caixa.id),
      resumoLocal(caixa.id),
      pendenciasDoCaixa(caixa.id),
    ]);
    return { carregando: false, caixa, movimentos, resumo, pendencias, ultimoFechado };
  }, []);
  const caixa = estado?.caixa ?? null;
  const caixaId = caixa?.id;
  const terminalId = caixa?.terminal_id;
  const aberturaSincronizada = caixa?.abertura_sincronizada;
  // Recebimentos de contas a receber nascem no servidor (online): traz-os ao caixa local para o saldo esperado ficar certo.
  useEffect(() => {
    if (!caixaId || !terminalId || !aberturaSincronizada) return;
    const atualizar = () => void atualizarRecebimentosDoServidor({ id: caixaId, terminal_id: terminalId, abertura_sincronizada: true });
    atualizar();
    const timer = setInterval(atualizar, 20_000);
    window.addEventListener("online", atualizar);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", atualizar);
    };
  }, [caixaId, terminalId, aberturaSincronizada]);
  return estado ?? VAZIO;
}
