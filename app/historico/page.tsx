import { History as HistoryIcon, ShoppingCart, Boxes } from "lucide-react";
import { listarHistorico } from "@/services/historico.service";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function HistoricoPage() {
  const eventos = await listarHistorico(7);

  return (
    <main className="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Histórico de Operações</h1>
        <p className="text-slate-500 text-sm">Últimos 7 dias</p>
      </header>

      <Card semPadding>
        {eventos.length === 0 ? (
          <EmptyState icone={HistoryIcon} titulo="Nenhuma operação no período" />
        ) : (
          <ul className="flex flex-col divide-y divide-slate-50 px-5 py-2">
            {eventos.map((e) => {
              const Icone = e.tipo === "venda" ? ShoppingCart : Boxes;
              return (
                <li key={`${e.tipo}-${e.id}`} className="flex items-start gap-3 py-3">
                  <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center shrink-0 mt-0.5">
                    <Icone className="w-4 h-4 text-brand-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-3">
                      <p className="text-slate-800">{e.descricao}</p>
                      <p className="text-slate-400 text-xs whitespace-nowrap shrink-0">
                        {new Date(e.created_at).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <p className="text-slate-500 text-sm">
                      {e.funcionario_nome}
                      {e.dispositivo && ` · ${e.dispositivo}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </main>
  );
}