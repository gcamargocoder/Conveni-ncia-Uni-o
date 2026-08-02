import { listarHistorico } from "@/services/historico.service";
import { FiltroPeriodoHistorico } from "@/components/historico/FiltroPeriodoHistorico";
import { HistoricoLista } from "@/components/historico/HistoricoLista";

export const dynamic = "force-dynamic";

const DIAS_POR_PRESET: Record<string, number> = { hoje: 0, "7dias": 7, "30dias": 30 };

export default async function HistoricoPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; de?: string; ate?: string }>;
}) {
  const { periodo: periodoParam, de, ate } = await searchParams;
  const periodo = periodoParam ?? "7dias";

  let inicio: Date;
  let fim: Date;

  if (periodo === "personalizado" && de && ate) {
    inicio = new Date(`${de}T00:00:00`);
    fim = new Date(`${ate}T23:59:59`);
  } else {
    const dias = DIAS_POR_PRESET[periodo] ?? 7;
    fim = new Date();
    inicio = new Date();
    inicio.setDate(inicio.getDate() - dias);
    inicio.setHours(0, 0, 0, 0);
  }

  const eventos = await listarHistorico(inicio, fim);
  const rotuloPeriodo = calcularRotuloPeriodo(periodo, de, ate);

  return (
    <main className="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header className="no-print">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Histórico de Operações</h1>
        <p className="text-slate-500 text-sm">Vendas e movimentações de estoque</p>
      </header>

      <div className="no-print">
        <FiltroPeriodoHistorico periodoAtual={periodo} deAtual={de} ateAtual={ate} />
      </div>

      <HistoricoLista eventos={eventos} rotuloPeriodo={rotuloPeriodo} />
    </main>
  );
}

function calcularRotuloPeriodo(periodo: string, de?: string, ate?: string): string {
  if (periodo === "hoje") return "Hoje";
  if (periodo === "7dias") return "Últimos 7 dias";
  if (periodo === "30dias") return "Últimos 30 dias";
  if (periodo === "personalizado" && de && ate) {
    const formatar = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
    return `${formatar(de)} até ${formatar(ate)}`;
  }
  return "Últimos 7 dias";
}