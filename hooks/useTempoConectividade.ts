"use client";

import { useState, useEffect, useRef } from "react";
import { useConectividade } from "./useConectividade";

export interface TempoConectividade {
  segundosOnline: number;
  segundosOffline: number;
}

export function useTempoConectividade(): TempoConectividade {
  const status = useConectividade();
  const [totais, setTotais] = useState<TempoConectividade>({ segundosOnline: 0, segundosOffline: 0 });
  const ultimaMudanca = useRef(Date.now());
  const statusAnterior = useRef(status);
  const [, forcarAtualizacao] = useState(0);

  useEffect(() => {
    const intervalo = setInterval(() => forcarAtualizacao((n) => n + 1), 1000);
    return () => clearInterval(intervalo);
  }, []);

  useEffect(() => {
    if (statusAnterior.current === status) return;

    const agora = Date.now();
    const decorridoSegundos = Math.floor((agora - ultimaMudanca.current) / 1000);

    setTotais((t) =>
      statusAnterior.current === "online"
        ? { ...t, segundosOnline: t.segundosOnline + decorridoSegundos }
        : { ...t, segundosOffline: t.segundosOffline + decorridoSegundos }
    );

    ultimaMudanca.current = agora;
    statusAnterior.current = status;
  }, [status]);

  const emCursoSegundos = Math.floor((Date.now() - ultimaMudanca.current) / 1000);

  return {
    segundosOnline: totais.segundosOnline + (status === "online" ? emCursoSegundos : 0),
    segundosOffline: totais.segundosOffline + (status === "offline" ? emCursoSegundos : 0),
  };
}