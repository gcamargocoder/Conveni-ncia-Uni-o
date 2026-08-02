import { listarEstoqueAtual } from "@/services/estoque.service";
import { ListaEstoque } from "@/components/estoque/ListaEstoque";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function EstoquePage() {
  const estoque = await listarEstoqueAtual();

  return (
    <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header className="no-print">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Estoque</h1>
        <p className="text-slate-500 text-sm">Entradas, perdas, ajustes e inventário</p>
      </header>

      <Card semPadding className="print:border-0 print:shadow-none">
        <ListaEstoque estoque={estoque} />
      </Card>
    </main>
  );
}