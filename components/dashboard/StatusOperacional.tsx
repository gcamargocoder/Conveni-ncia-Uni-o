"use client";

import { Wifi, WifiOff } from "lucide-react";
import { useConectividade } from "@/hooks/useConectividade";
import { usePendenciasSincronizacao } from "@/hooks/usePendenciasSincronizacao";
import { useStatusSincronizacaoCatalogo } from "@/hooks/useStatusSincronizacaoCatalogo";
import { useUltimaSincronizacaoFila } from "@/hooks/useUltimaSincronizacaoFila";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

function formatarHorario(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Reaproveita os MESMOS hooks do indicador global (IndicadorConexao) —
 * nada da infraestrutura Offline First foi alterado, isso só apresenta
 * a mesma informação com mais contexto, dentro do dashboard (pedido
 * explícito da Etapa 7: "Status Offline First / sincronização / conexão").
 */
export function StatusOperacional() {
  const status = useConectividade();
  const pendentes = usePendenciasSincronizacao();
  const statusCatalogo = useStatusSincronizacaoCatalogo();
  const ultimaSincFila = useUltimaSincronizacaoFila();

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Status operacional</h3>
        {status === "online" ? (
          <Badge variante="success">
            <Wifi className="w-3 h-3 mr-1" />
            Online
          </Badge>
        ) : (
          <Badge variante="danger">
            <WifiOff className="w-3 h-3 mr-1" />
            Offline
          </Badge>
        )}
      </div>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-slate-500 text-xs">Fila pendente</dt>
          <dd className="font-semibold text-slate-900 mt-0.5">{pendentes ?? 0}</dd>
        </div>
        <div>
          <dt className="text-slate-500 text-xs">Sinc. vendas</dt>
          <dd className="font-semibold text-slate-900 mt-0.5">{formatarHorario(ultimaSincFila)}</dd>
        </div>
        <div>
          <dt className="text-slate-500 text-xs">Sinc. catálogo</dt>
          <dd className="font-semibold text-slate-900 mt-0.5">{formatarHorario(statusCatalogo?.timestamp)}</dd>
        </div>
      </dl>
    </Card>
  );
}