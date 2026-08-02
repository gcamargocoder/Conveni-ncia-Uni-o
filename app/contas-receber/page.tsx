import { Receipt } from "lucide-react";
import { listarDevedores } from "@/services/contas-receber.service";
import { ListaDevedores } from "@/components/contas-receber/ListaDevedores";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function ContasReceberPage() {
  const devedores = await listarDevedores();

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header className="no-print">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Contas a Receber</h1>
        <p className="text-slate-500 text-sm">Vendas fiado, pagamentos e devedores</p>
      </header>

      <Card semPadding className="print:border-0 print:shadow-none">
        <div className="flex items-center gap-2 px-5 pt-1 mb-1 no-print">
          <Receipt className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Clientes ({devedores.length})</h2>
        </div>
        <ListaDevedores devedores={devedores} />
      </Card>
    </main>
  );
}