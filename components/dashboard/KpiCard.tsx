import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";

export interface KpiCardProps {
  icone: LucideIcon;
  rotulo: string;
  valor: string;
  destaque?: boolean;
}

/**
 * Peça reutilizável dos KPIs principais do dashboard. `destaque` dá o
 * tratamento de "KPI herói" (fundo em gradiente da cor de marca, texto
 * branco) — o mesmo princípio que Stripe/Linear usam para hierarquizar
 * visualmente o número mais importante da linha. Para a variante em
 * destaque, não reaproveitamos o Card (que fixa fundo branco e borda
 * cinza) — estilizado à parte, para não depender de sobrescrever
 * classes com !important.
 */
export function KpiCard({ icone: Icone, rotulo, valor, destaque }: KpiCardProps) {
  if (destaque) {
    return (
      <div className="rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 shadow-card p-5 flex items-center gap-4">
        <div className="w-11 h-11 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
          <Icone className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-xs font-medium text-brand-100 tracking-wide">{rotulo}</p>
          <p className="text-2xl font-bold text-white tabular-nums tracking-tight">{valor}</p>
        </div>
      </div>
    );
  }

  return (
    <Card className="flex items-center gap-4">
      <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-brand-50 to-brand-100 flex items-center justify-center shrink-0">
        <Icone className="w-5 h-5 text-brand-700" />
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500 tracking-wide">{rotulo}</p>
        <p className="text-2xl font-bold text-slate-900 tabular-nums tracking-tight">{valor}</p>
      </div>
    </Card>
  );
}