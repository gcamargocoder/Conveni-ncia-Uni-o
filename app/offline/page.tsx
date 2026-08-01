"use client";

import { useEffect } from "react";
import Image from "next/image";
import { WifiOff } from "lucide-react";
import { useConectividade } from "@/hooks/useConectividade";
import { usePendenciasSincronizacao } from "@/hooks/usePendenciasSincronizacao";

export default function OfflinePage() {
  const status = useConectividade();
  const pendentes = usePendenciasSincronizacao();

  useEffect(() => {
    if (status !== "online") return;
    const temporizador = setTimeout(() => {
      window.location.href = "/pdv";
    }, 1200);
    return () => clearTimeout(temporizador);
  }, [status]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 py-12 bg-brand-700 text-white text-center">
      <Image
        src="/logo-auto-posto-uniao.jpeg"
        alt="Auto Posto União"
        width={72}
        height={72}
        className="rounded-2xl"
      />

      <div>
        <h1 className="text-xl font-bold">Conveniência União</h1>
        <p className="text-brand-100 text-sm mt-1">Sistema funcionando offline</p>
      </div>

      <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2">
        <WifiOff className="w-4 h-4" />
        <span className="text-sm">{status === "online" ? "Reconectado — voltando..." : "Tentando reconectar..."}</span>
      </div>

      {!!pendentes && pendentes > 0 && (
        <p className="text-brand-100 text-sm">{pendentes} operação(ões) aguardando sincronizar.</p>
      )}

      <p className="text-brand-100 text-xs max-w-xs">
        Suas vendas e movimentações continuam funcionando normalmente — tudo é salvo neste
        dispositivo e sincroniza automaticamente assim que a conexão voltar.
      </p>

      <a href="/pdv" className="mt-2 rounded-lg bg-white text-brand-700 font-semibold px-5 py-2.5 text-sm">
        Ir para o PDV
      </a>
    </main>
  );
}