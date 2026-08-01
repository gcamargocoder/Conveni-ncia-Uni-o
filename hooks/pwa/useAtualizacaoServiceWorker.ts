"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { registrarServiceWorker, ativarNovaVersao } from "@/services/pwa/registro-service-worker";

export function useAtualizacaoServiceWorker() {
  const [atualizacaoDisponivel, setAtualizacaoDisponivel] = useState(false);
  const [registro, setRegistro] = useState<ServiceWorkerRegistration | null>(null);
  const recarregandoRef = useRef(false);

  useEffect(() => {
    registrarServiceWorker((reg) => {
      setRegistro(reg);
      setAtualizacaoDisponivel(true);
    }).then((resultado) => {
      if (resultado.registro) setRegistro(resultado.registro);
    });

    function aoTrocarController() {
      if (recarregandoRef.current) return;
      recarregandoRef.current = true;
      window.location.reload();
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", aoTrocarController);
    }
    return () => {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", aoTrocarController);
      }
    };
  }, []);

  const atualizarAgora = useCallback(() => {
    if (registro) ativarNovaVersao(registro);
  }, [registro]);

  return { atualizacaoDisponivel, atualizarAgora };
}