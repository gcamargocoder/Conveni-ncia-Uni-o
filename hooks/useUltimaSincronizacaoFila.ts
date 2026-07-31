"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { obterUltimaSincronizacaoFila } from "@/services/offline/worker-sincronizacao.service";

export function useUltimaSincronizacaoFila(): string | null | undefined {
  return useLiveQuery(() => {
    if (typeof indexedDB === "undefined") return null;
    return obterUltimaSincronizacaoFila();
  }, []);
}
