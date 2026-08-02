"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

const PRESETS = [
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "7dias", rotulo: "7 dias" },
  { valor: "30dias", rotulo: "30 dias" },
];

interface FiltroPeriodoHistoricoProps {
  periodoAtual: string;
  deAtual?: string;
  ateAtual?: string;
}

export function FiltroPeriodoHistorico({ periodoAtual, deAtual, ateAtual }: FiltroPeriodoHistoricoProps) {
  const router = useRouter();
  const [mostrarPersonalizado, setMostrarPersonalizado] = useState(periodoAtual === "personalizado");
  const [de, setDe] = useState(deAtual ?? "");
  const [ate, setAte] = useState(ateAtual ?? "");

  function irParaPreset(valor: string) {
    setMostrarPersonalizado(false);
    router.push(`/historico?periodo=${valor}`);
  }

  function aplicarPersonalizado() {
    if (!de || !ate) return;
    router.push(`/historico?periodo=personalizado&de=${de}&ate=${ate}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.valor}
            onClick={() => irParaPreset(p.valor)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              periodoAtual === p.valor ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {p.rotulo}
          </button>
        ))}
        <button
          onClick={() => setMostrarPersonalizado((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            periodoAtual === "personalizado"
              ? "bg-brand-700 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          Período personalizado
        </button>
      </div>

      {mostrarPersonalizado && (
        <div className="flex flex-wrap items-end gap-2">
          <Input rotulo="Data inicial" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          <Input rotulo="Data final" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          <Button tamanho="sm" onClick={aplicarPersonalizado} disabled={!de || !ate}>
            Aplicar
          </Button>
        </div>
      )}
    </div>
  );
}