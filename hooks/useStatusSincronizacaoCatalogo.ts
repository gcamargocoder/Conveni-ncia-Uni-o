"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { obterUltimaSincronizacao } from "@/services/offline/sincronizacao-catalogo.service";

export function useStatusSincronizacaoCatalogo() {
  return useLiveQuery(() => {
    // mesma proteção de SSR já usada em usePendenciasSincronizacao.ts
    if (typeof indexedDB === "undefined") return { timestamp: null, quantidade: 0 };
    return obterUltimaSincronizacao();
  }, []);
}
