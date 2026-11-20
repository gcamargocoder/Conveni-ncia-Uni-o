import { HistoricoCaixas } from "@/components/caixa/HistoricoCaixas";
import { exigirAdmin } from "@/lib/auth/servidor";

export const dynamic = "force-dynamic";

export const metadata = { title: "Histórico e relatórios de caixa — Conveniência União" };

// Dados financeiros de todos os caixas: somente administrador (as ações também exigem o papel no servidor).
export default async function HistoricoCaixasPage() {
  await exigirAdmin();
  return (
    <main className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Histórico e relatórios de caixa</h1>
        <p className="text-slate-500 text-sm">
          Caixas abertos e fechados, divergências, sangrias, suprimentos e despesas. Valores confirmados pelo servidor.
        </p>
      </header>
      <HistoricoCaixas />
    </main>
  );
}
