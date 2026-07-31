import { buscarVendaCompleta } from "@/services/vendas.service";
import { ReciboTermico } from "@/components/pdv/ReciboTermico";
import { notFound } from "next/navigation";

// Next.js 15: params passou a ser uma Promise (antes era um objeto
// direto) — precisa dar await antes de usar. Sem isso, o `next build`
// falha na checagem de tipos gerada automaticamente (só aparece no
// build de produção, não no `npx tsc --noEmit` isolado nem no `next dev`).
export default async function CupomPage({ params }: { params: Promise<{ vendaId: string }> }) {
  const { vendaId } = await params;
  const venda = await buscarVendaCompleta(vendaId);

  if (!venda) notFound();

  return (
    <main className="min-h-screen bg-slate-100 py-8">
      <ReciboTermico venda={venda} />
    </main>
  );
}