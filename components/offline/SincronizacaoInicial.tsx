"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useConectividade } from "@/hooks/useConectividade";
import { sincronizarCatalogo } from "@/services/offline/sincronizacao-catalogo.service";
import { getOfflineDB } from "@/services/offline/db";

const INTERVALO_MS = 30000;

/**
 * Vendas ainda não confirmadas pelo servidor já baixaram o estoque local; trazer o estoque do
 * servidor por cima desfaria essa baixa. Enquanto houver fila, a ressincronização espera.
 */
async function haVendasNaoEnviadas(): Promise<boolean> {
  const pendentes = await getOfflineDB()
    .fila_sincronizacao.where("status")
    .anyOf("pendente", "sincronizando", "erro")
    .count();
  return pendentes > 0;
}

/**
 * Sem saída visual — só efeito colateral. Dispara a sincronização do
 * catálogo ao carregar o app e sempre que a conexão volta depois de
 * ficar offline (requisito 1: "ao iniciar o sistema" + detectar
 * reconexão). Também ressincroniza ao trocar de tela, ao voltar para a
 * aba e a cada INTERVALO_MS: o app é uma SPA, então uma entrada de
 * estoque feita na tela de Estoque não recarrega a página e o PDV
 * continuaria vendo a cópia local antiga. `sincronizando` evita
 * disparos concorrentes.
 */
export function SincronizacaoInicial() {
  const status = useConectividade();
  const pathname = usePathname();
  const sincronizando = useRef(false);
  const primeira = useRef(true);

  useEffect(() => {
    if (status !== "online") return;

    async function sincronizar(ignorarFila: boolean) {
      if (sincronizando.current) return;
      sincronizando.current = true;
      try {
        if (!ignorarFila && (await haVendasNaoEnviadas())) return;
        await sincronizarCatalogo();
      } finally {
        sincronizando.current = false;
      }
    }

    sincronizar(primeira.current);
    primeira.current = false;

    const intervalo = setInterval(() => sincronizar(false), INTERVALO_MS);
    function aoVoltarParaAba() {
      if (document.visibilityState === "visible") sincronizar(false);
    }
    document.addEventListener("visibilitychange", aoVoltarParaAba);

    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltarParaAba);
    };
  }, [status, pathname]);

  return null;
}
