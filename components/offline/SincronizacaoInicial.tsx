"use client";

import { useEffect, useRef } from "react";
import { useConectividade } from "@/hooks/useConectividade";
import { sincronizarCatalogo } from "@/services/offline/sincronizacao-catalogo.service";

/**
 * Sem saída visual própria — só efeito colateral. Dispara a
 * sincronização do catálogo ao carregar o app e sempre que a conexão
 * volta depois de ficar offline (requisito 1: "ao iniciar o sistema" +
 * detectar reconexão). `sincronizando` evita disparos concorrentes se
 * o status oscilar rápido entre online/offline.
 */
export function SincronizacaoInicial() {
  const status = useConectividade();
  const sincronizando = useRef(false);

  useEffect(() => {
    if (status !== "online" || sincronizando.current) return;

    sincronizando.current = true;
    sincronizarCatalogo().finally(() => {
      sincronizando.current = false;
    });
  }, [status]);

  return null;
}
