import type { LucideIcon } from "lucide-react";

export interface KpiCardProps {
  icone: LucideIcon;
  rotulo: string;
  valor: string;
  destaque?: boolean;
}

/**
 * Peça reutilizável dos KPIs principais do dashboard (tema escuro). `destaque` dá o tratamento de
 * "KPI herói" (fundo azul royal da marca, texto branco) para hierarquizar o número mais importante.
 * Não reaproveita o Card compartilhado (fundo branco) para não depender de sobrescrever classes.
 */
export function KpiCard({ icone: Icone, rotulo, valor, destaque }: KpiCardProps) {
  if (destaque) {
    return (
      <div className="rounded-xl bg-gradient-to-br from-brand-blue to-brand-blue-hover border border-brand-blue/40 shadow-card p-5 flex items-center gap-4">
        <div className="w-11 h-11 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
          <Icone className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-xs font-medium text-blue-100 tracking-wide">{rotulo}</p>
          <p className="text-3xl font-bold text-white tabular-nums tracking-tight">{valor}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-surface-border bg-surface shadow-card p-5 flex items-center gap-4">
      <div className="w-11 h-11 rounded-lg bg-surface-elevated border border-surface-border flex items-center justify-center shrink-0">
        <Icone className="w-5 h-5 text-brand-blue" />
      </div>
      <div>
        <p className="text-xs font-medium text-zinc-400 tracking-wide">{rotulo}</p>
        <p className="text-3xl font-bold text-white tabular-nums tracking-tight">{valor}</p>
      </div>
    </div>
  );
}
