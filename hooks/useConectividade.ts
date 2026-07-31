"use client";

import { useState, useEffect } from "react";

export type StatusConexao = "online" | "offline";

/**
 * Detecta o status de conexão via eventos nativos do navegador
 * (`online`/`offline`, disparados pelo próprio browser). Não faz
 * nenhuma chamada de rede própria para testar conectividade — os
 * eventos nativos já bastam para o indicador visual desta etapa.
 * Uma etapa futura pode reforçar isso com um "ping" leve, se
 * necessário (o evento `online` do navegador às vezes é otimista
 * demais — mas isso é um refinamento, não infraestrutura básica).
 */
export function useConectividade(): StatusConexao {
  // navigator.onLine não existe durante SSR — assume "online" até o
  // primeiro efeito rodar no navegador, para não piscar "offline" à toa.
  const [status, setStatus] = useState<StatusConexao>("online");

  useEffect(() => {
    setStatus(navigator.onLine ? "online" : "offline");

    function handleOnline() {
      setStatus("online");
    }
    function handleOffline() {
      setStatus("offline");
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return status;
}
