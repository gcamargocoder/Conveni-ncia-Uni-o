"use client";

import { useState } from "react";
import { useConectividade } from "@/hooks/useConectividade";
import { usePendenciasSincronizacao } from "@/hooks/usePendenciasSincronizacao";
import { useStatusSincronizacaoCatalogo } from "@/hooks/useStatusSincronizacaoCatalogo";
import { useUltimaSincronizacaoFila } from "@/hooks/useUltimaSincronizacaoFila";

function formatarHorario(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Indicador discreto, flutuante no canto superior direito — não é mais
 * uma faixa ocupando a largura inteira da tela. Clique para expandir
 * detalhes (última sincronização de catálogo/vendas, pendências).
 * Mesmos hooks de antes — só a apresentação mudou.
 */
export function IndicadorConexao() {
  const [aberto, setAberto] = useState(false);
  const status = useConectividade();
  const pendentes = usePendenciasSincronizacao();
  const statusCatalogo = useStatusSincronizacaoCatalogo();
  const ultimaSincFila = useUltimaSincronizacaoFila();

  const sincronizando = status === "online" && !!pendentes && pendentes > 0;

  const cores =
    status === "offline"
      ? "bg-danger-50 text-danger-700"
      : sincronizando
        ? "bg-warning-50 text-warning-700"
        : "bg-success-50 text-success-700";

  const corPonto = status === "offline" ? "bg-danger-600" : sincronizando ? "bg-warning-600" : "bg-success-600";

  const texto = status === "offline" ? "Offline" : sincronizando ? `Sincronizando (${pendentes})` : "Online";

  return (
    <div className="fixed top-4 right-4 z-40">
      <button
        onClick={() => setAberto((a) => !a)}
        className={`flex items-center gap-1.5 rounded-full pl-2.5 pr-3 py-1.5 text-xs font-medium shadow-card transition-colors ${cores}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${corPonto}`} />
        {texto}
      </button>

      {aberto && (
        <div className="absolute right-0 mt-2 w-52 rounded-xl border border-slate-200 bg-white shadow-elevated p-4 animate-slide-up">
          <dl className="flex flex-col gap-2 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500">Catálogo</dt>
              <dd className="font-medium text-slate-800">{formatarHorario(statusCatalogo?.timestamp)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Vendas</dt>
              <dd className="font-medium text-slate-800">{formatarHorario(ultimaSincFila)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Pendentes</dt>
              <dd className="font-medium text-slate-800">{pendentes ?? 0}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}