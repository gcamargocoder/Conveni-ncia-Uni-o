import { Tags } from "lucide-react";
import { listarCategorias } from "@/services/categorias.service";
import { ListaCategorias } from "@/components/categorias/ListaCategorias";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function CategoriasPage() {
  const categorias = await listarCategorias();

  return (
    <main className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Categorias</h1>
        <p className="text-slate-500 text-sm">Editar ou excluir categorias de produtos</p>
      </header>

      <Card semPadding>
        <div className="flex items-center gap-2 px-5 pt-1 mb-1">
          <Tags className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Categorias ({categorias.length})</h2>
        </div>
        <ListaCategorias categorias={categorias} />
      </Card>
    </main>
  );
}