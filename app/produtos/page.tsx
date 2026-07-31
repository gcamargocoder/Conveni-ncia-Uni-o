import { Tags, List } from "lucide-react";
import { listarProdutos } from "@/services/produtos.service";
import { createSupabaseServerClient } from "@/services/supabase/server";
import { ProdutoForm } from "@/components/produtos/ProdutoForm";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function ProdutosPage() {
  const supabase = await createSupabaseServerClient();
  const [produtos, { data: categorias }] = await Promise.all([
    listarProdutos(),
    supabase.from("categorias").select("id, nome").is("deleted_at", null).order("nome"),
  ]);

  return (
    <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Produtos</h1>
        <p className="text-slate-500 text-sm">Produtos e categorias</p>
      </header>

      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Tags className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Novo produto</h2>
        </div>
        <ProdutoForm categorias={categorias ?? []} />
      </Card>

      <Card semPadding>
        <div className="flex items-center gap-2 px-5 pt-5 mb-1">
          <List className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Cadastrados ({produtos.length})</h2>
        </div>
        {produtos.length === 0 ? (
          <EmptyState icone={Tags} titulo="Nenhum produto cadastrado ainda" />
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100">
                <th className="py-2 px-5 font-medium">Nome</th>
                <th className="py-2 px-5 font-medium">Preço</th>
                <th className="py-2 px-5 font-medium">Estoque mín.</th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-3 px-5 text-slate-800">{p.nome}</td>
                  <td className="py-3 px-5 tabular-nums text-slate-800">R$ {p.preco_venda.toFixed(2)}</td>
                  <td className="py-3 px-5 tabular-nums text-slate-500">{p.estoque_minimo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  );
}