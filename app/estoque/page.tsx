import { Boxes, ClipboardList } from "lucide-react";
import { listarEstoqueAtual } from "@/services/estoque.service";
import { createSupabaseServerClient } from "@/services/supabase/server";
import { MovimentacaoForm } from "@/components/estoque/MovimentacaoForm";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function EstoquePage() {
  const supabase = await createSupabaseServerClient();
  const [estoque, { data: produtos }] = await Promise.all([
    listarEstoqueAtual(),
    supabase.from("produtos").select("id, nome").is("deleted_at", null).order("nome"),
  ]);

  return (
    <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Estoque</h1>
        <p className="text-slate-500 text-sm">Entradas, perdas, ajustes e inventário</p>
      </header>

      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Boxes className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Registrar movimentação</h2>
        </div>
        <MovimentacaoForm produtos={produtos ?? []} />
      </Card>

      <Card semPadding>
        <div className="flex items-center gap-2 px-5 pt-5 mb-1">
          <ClipboardList className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Situação atual</h2>
        </div>
        {estoque.length === 0 ? (
          <EmptyState icone={Boxes} titulo="Nenhum produto no estoque ainda" />
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100">
                <th className="py-2 px-5 font-medium">Produto</th>
                <th className="py-2 px-5 font-medium">Quantidade</th>
                <th className="py-2 px-5 font-medium">Mínimo</th>
                <th className="py-2 px-5 font-medium">Alerta</th>
              </tr>
            </thead>
            <tbody>
              {estoque.map((e) => (
                <tr key={e.produto_id} className="border-b border-slate-50 last:border-0">
                  <td className="py-3 px-5 text-slate-800">{e.nome}</td>
                  <td className="py-3 px-5 tabular-nums text-slate-800">{e.quantidade_atual}</td>
                  <td className="py-3 px-5 tabular-nums text-slate-500">{e.estoque_minimo}</td>
                  <td className="py-3 px-5">
                    {e.quantidade_atual < e.estoque_minimo && <Badge variante="warning">Estoque baixo</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  );
}