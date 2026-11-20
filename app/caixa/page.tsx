import { PainelCaixa } from "@/components/caixa/PainelCaixa";
import { exigirSessao } from "@/lib/auth/servidor";

export const metadata = { title: "Caixa — Conveniência União" };

// O caixa deste terminal vive no aparelho (IndexedDB) e funciona offline: a página só exige a sessão.
export default async function CaixaPage() {
  await exigirSessao();
  return (
    <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Caixa</h1>
        <p className="text-slate-500 text-sm">Abertura, movimentações, conferência e fechamento do caixa deste terminal</p>
      </header>
      <PainelCaixa />
    </main>
  );
}
