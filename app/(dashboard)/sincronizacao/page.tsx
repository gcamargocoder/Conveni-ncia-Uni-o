"use client";

import { Wifi, WifiOff, Clock, CheckCircle2, AlertTriangle, GitMerge, ListOrdered, History } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useDashboardSincronizacao } from "@/hooks/useDashboardSincronizacao";
import type { StatusFila } from "@/services/offline/db";

function formatarHorario(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatarDuracao(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min ${s}s`;
  return `${s}s`;
}

const BADGE_STATUS_FILA: Record<StatusFila, { variante: "neutral" | "brand" | "danger" | "success"; rotulo: string }> = {
  pendente: { variante: "neutral", rotulo: "Pendente" },
  sincronizando: { variante: "brand", rotulo: "Sincronizando" },
  erro: { variante: "danger", rotulo: "Erro" },
  sincronizado: { variante: "success", rotulo: "Sincronizado" },
};

export default function SincronizacaoPage() {
  const { status, tempoConectividade, statusCatalogo, dados } = useDashboardSincronizacao();

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sincronização</h1>
        <p className="text-slate-500 text-sm">Monitoramento em tempo real — Offline First</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="flex items-center gap-4">
          <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${status === "online" ? "bg-success-50" : "bg-danger-50"}`}>
            {status === "online" ? (
              <Wifi className="w-5 h-5 text-success-600" />
            ) : (
              <WifiOff className="w-5 h-5 text-danger-600" />
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 tracking-wide">Status atual</p>
            <p className="text-2xl font-bold text-slate-900 tracking-tight">{status === "online" ? "Online" : "Offline"}</p>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-brand-700" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 tracking-wide">Tempo nesta sessão</p>
            <p className="text-sm font-semibold text-slate-900">
              Online: {formatarDuracao(tempoConectividade.segundosOnline)} · Offline:{" "}
              {formatarDuracao(tempoConectividade.segundosOffline)}
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <p className="text-xs font-medium text-slate-500">Pendentes</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{dados?.pendentes ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-slate-500">Sincronizados</p>
          <p className="text-2xl font-bold text-success-600 tabular-nums">{dados?.sincronizados ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-slate-500">Com erro</p>
          <p className="text-2xl font-bold text-danger-600 tabular-nums">{dados?.comErro ?? "—"}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-slate-500">Conflitos resolvidos</p>
          <p className="text-2xl font-bold text-warning-600 tabular-nums">{dados?.conflitosResolvidos ?? "—"}</p>
        </Card>
      </div>

      <Card>
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Última sincronização</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-slate-500 text-xs">Catálogo</p>
            <p className="font-medium text-slate-800">{formatarHorario(statusCatalogo?.timestamp)}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">Vendas</p>
            <p className="font-medium text-slate-800">{formatarHorario(dados?.ultimaSincronizacaoFila)}</p>
          </div>
        </div>
      </Card>

      <Card semPadding>
        <div className="flex items-center gap-2 px-5 pt-5 mb-1">
          <ListOrdered className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Fila atual</h2>
        </div>
        {!dados || dados.filaAtual.length === 0 ? (
          <EmptyState icone={GitMerge} titulo="Nenhuma operação pendente" descricao="Tudo sincronizado." />
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100">
                <th className="py-2 px-5 font-medium">Tipo</th>
                <th className="py-2 px-5 font-medium">Status</th>
                <th className="py-2 px-5 font-medium">Tentativas</th>
                <th className="py-2 px-5 font-medium">Criado em</th>
                <th className="py-2 px-5 font-medium">Erro</th>
              </tr>
            </thead>
            <tbody>
              {dados.filaAtual.map((item) => {
                const badge = BADGE_STATUS_FILA[item.status];
                return (
                  <tr key={item.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-3 px-5 text-slate-800 capitalize">{item.tipo.replace("_", " ")}</td>
                    <td className="py-3 px-5">
                      <Badge variante={badge.variante}>{badge.rotulo}</Badge>
                    </td>
                    <td className="py-3 px-5 tabular-nums text-slate-600">{item.tentativas}</td>
                    <td className="py-3 px-5 text-slate-500">{formatarHorario(item.criado_em)}</td>
                    <td className="py-3 px-5 text-danger-600 text-xs">{item.erro ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card semPadding>
        <div className="flex items-center gap-2 px-5 pt-5 mb-1">
          <History className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Últimos eventos</h2>
        </div>
        {!dados || dados.ultimosEventos.length === 0 ? (
          <EmptyState icone={History} titulo="Nenhum evento registrado ainda" />
        ) : (
          <ul className="flex flex-col divide-y divide-slate-50 px-5 pb-5">
            {dados.ultimosEventos.map((e) => (
              <li key={e.id} className="py-3 flex items-start gap-3">
                {e.tipo.includes("erro") ? (
                  <AlertTriangle className="w-4 h-4 text-danger-600 mt-0.5 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-success-600 mt-0.5 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm text-slate-800">
                    {e.tipo.replace(/_/g, " ")}
                    {e.detalhes && <span className="text-slate-500"> — {e.detalhes}</span>}
                  </p>
                  <p className="text-xs text-slate-400">{formatarHorario(e.timestamp)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}