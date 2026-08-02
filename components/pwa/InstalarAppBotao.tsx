"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { usePlataforma } from "@/hooks/pwa/usePlataforma";

interface EventoBeforeInstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const CHAVE_DISPENSADO = "instalar-app-dispensado";

export function InstalarAppBotao() {
  const { sistemaOperacional, instalado, podeInstalarNativo } = usePlataforma();
  const [promptEvento, setPromptEvento] = useState<EventoBeforeInstallPrompt | null>(null);
  const [dispensado, setDispensado] = useState(true);

  useEffect(() => {
    setDispensado(localStorage.getItem(CHAVE_DISPENSADO) === "true");

    function aoDispararPrompt(evento: Event) {
      evento.preventDefault();
      setPromptEvento(evento as EventoBeforeInstallPrompt);
    }

    window.addEventListener("beforeinstallprompt", aoDispararPrompt);
    return () => window.removeEventListener("beforeinstallprompt", aoDispararPrompt);
  }, []);

  function dispensar() {
    localStorage.setItem(CHAVE_DISPENSADO, "true");
    setDispensado(true);
  }

  async function instalar() {
    if (!promptEvento) return;
    await promptEvento.prompt();
    const escolha = await promptEvento.userChoice;
    if (escolha.outcome === "accepted") setPromptEvento(null);
  }

  if (instalado || dispensado) return null;

  if (sistemaOperacional === "ios" && !podeInstalarNativo) {
    return (
      <div className="no-print fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-40 rounded-xl bg-white border border-slate-200 shadow-elevated p-4 flex flex-col gap-2 animate-slide-up">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900">Instalar o aplicativo</p>
          <button onClick={dispensar} aria-label="Fechar" className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-slate-600">
          Toque em <Share className="w-3.5 h-3.5 inline mx-0.5" /> Compartilhar e depois em &quot;Adicionar à
          Tela de Início&quot;.
        </p>
      </div>
    );
  }

  if (!promptEvento) return null;

  return (
    <div className="no-print fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-40 rounded-xl bg-white border border-slate-200 shadow-elevated p-4 flex items-center gap-3 animate-slide-up">
      <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
        <Download className="w-5 h-5 text-brand-700" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900">Instalar aplicativo</p>
        <p className="text-xs text-slate-500">Acesso rápido, direto da tela inicial.</p>
      </div>
      <Button tamanho="sm" onClick={instalar}>
        Instalar
      </Button>
      <button onClick={dispensar} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}