import { ClipboardCheck } from "lucide-react";
import { exigirAdmin } from "@/lib/auth/servidor";
import { listarVendasEmRevisao } from "@/services/vendas-sincronizadas.service";
import { VendaRevisaoCartao } from "@/components/vendas/VendaRevisaoCartao";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

export const metadata = { title: "Vendas em revisão — Conveniência União" };

export default async function VendasRevisaoPage() {
  await exigirAdmin();
  const vendas = await listarVendasEmRevisao("pendente");

  return (
    <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Vendas em revisão</h1>
        <p className="text-slate-500 text-sm">
          Vendas feitas no PDV (inclusive offline) cujos valores ou funcionário não conferem com o cadastro. Enquanto não
          forem aprovadas, não entram no faturamento nem baixam o estoque. Nada é apagado.
        </p>
      </header>

      {vendas.length === 0 ? (
        <Card>
          <EmptyState
            icone={ClipboardCheck}
            titulo="Nenhuma venda aguardando revisão"
            descricao="Tudo o que foi sincronizado conferiu com o cadastro."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {vendas.map((v) => (
            <VendaRevisaoCartao key={v.id} venda={v} />
          ))}
        </div>
      )}
    </main>
  );
}
