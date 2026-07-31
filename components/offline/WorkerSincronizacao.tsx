"use client";

import { useEffect, useRef } from "react";
import { useConectividade } from "@/hooks/useConectividade";
import { processarFilaSincronizacao } from "@/services/offline/worker-sincronizacao.service";

const INTERVALO_MS = 15000;

/**
 * Sem saída visual — só efeito colateral. Roda em segundo plano:
 * imediatamente ao ficar online e depois a cada INTERVALO_MS enquanto
 * a conexão durar. O operador nunca precisa clicar em "sincronizar"
 * (requisito da Fase 4).
 */
export function WorkerSincronizacao() {
  const status = useConectividade();
  const processando = useRef(false);

  useEffect(() => {
    if (status !== "online") return;

    async function tentar() {
      if (processando.current) return;
      processando.current = true;
      try {
        await processarFilaSincronizacao();
      } finally {
        processando.current = false;
      }
    }

    tentar();
    const intervalo = setInterval(tentar, INTERVALO_MS);
    return () => clearInterval(intervalo);
  }, [status]);

  return null;
}
