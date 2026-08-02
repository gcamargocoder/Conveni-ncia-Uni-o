import { Receipt } from "lucide-react";
import { listarContas } from "@/services/contas-receber.service";
import { ListaContasReceber } from "@/components/contas-receber/ListaContasReceber";
import { Card } from "@/components/ui/Card";
import type { StatusConta } from "@/types/conta-receber";

export const dynamic = "force-dynamic";

const STATUS_VALIDOS: StatusConta[] = ["ABERTA", "PARCIAL", "QUITADA"];

export default async function ContasReceberPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusParam } = await searchParams;
  const status = STATUS_VALIDOS.includes(statusParam as StatusConta) ? (statusParam as StatusConta) : undefined;

  const contas = await listarContas(status);

  return (
    <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Contas a Receber</h1>
        <p className="text-slate-500 text-sm">Vendas fiado e pagamentos</p>
      </header>

      <Card semPadding>
        <div className="flex items-center gap-2 px-5 pt-1 mb-1">
          <Receipt className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Contas ({contas.length})</h2>
        </div>
        <ListaContasReceber contas={contas} statusAtual={status ?? ""} />
      </Card>
    </main>
  );
}