"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { contarPendentes } from "@/services/offline/fila-sincronizacao.service";

/**
 * useLiveQuery reexecuta automaticamente sempre que a tabela
 * fila_sincronizacao muda — sem precisar de polling manual. Retorna
 * `undefined` só no primeiro instante (antes do IndexedDB responder),
 * então o indicador visual trata 0 e "carregando" de forma diferente.
 */
export function usePendenciasSincronizacao(): number | undefined {
  return useLiveQuery(() => {
    // Next.js renderiza Client Components uma vez no servidor antes da
    // hidratação — sem essa checagem, essa primeira passada quebraria
    // tentando acessar um IndexedDB que não existe fora do navegador.
    if (typeof indexedDB === "undefined") return 0;
    return contarPendentes();
  }, []);
}
