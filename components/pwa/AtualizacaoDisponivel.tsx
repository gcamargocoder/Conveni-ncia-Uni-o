"use client";

import { RefreshCw } from "lucide-react";
import { useAtualizacaoServiceWorker } from "@/hooks/pwa/useAtualizacaoServiceWorker";
import { Button } from "@/components/ui/Button";

export function AtualizacaoDisponivel() {
  const { atualizacaoDisponivel, atualizarAgora } = useAtualizacaoServiceWorker();

  if (!atualizacaoDisponivel) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full bg-slate-900 text-white pl-4 pr-2 py-2 shadow-elevated animate-slide-up">
      <RefreshCw className="w-4 h-4 shrink-0" />
      <span className="text-sm font-medium whitespace-nowrap">Nova versão disponível</span>
      <Button tamanho="sm" onClick={atualizarAgora}>
        Atualizar agora
      </Button>
    </div>
  );
}