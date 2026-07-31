import Link from "next/link";
import { listarVendasPorPeriodo, resumirPorFormaPagamento } from "@/services/relatorios.service";
import { listarEstoqueAtual } from "@/services/estoque.service";

const PERIODOS: Record<string, number> = { hoje: 1, "7dias": 7, "30dias": 30 };

// Next.js 15: searchParams também passou a ser uma Promise — mesmo
// motivo do params em rotas dinâmicas (ver app/pdv/cupom/[vendaId]/page.tsx).
export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { periodo: periodoParam } = await searchParams;
  const periodo = periodoParam ?? "7dias";
  const dias = PERIODOS[periodo] ?? 7;

  const fim = new Date();
  const inicio = new Date();
  inicio.setDate(inicio.getDate() - dias);

  const [vendas, estoque] = await Promise.all([
    listarVendasPorPeriodo(inicio, fim),
    listarEstoqueAtual(),
  ]);

  const resumo = resumirPorFormaPagamento(vendas);
  const totalGeral = resumo.reduce((s, r) => s + r.total, 0);

  return (
    <main className="max-w-4xl mx-auto p-6 flex flex-col gap-8">
      <h1 className="text-2xl font-bold text-slate-900">Relatórios</h1>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-700">Vendas</h2>
          <div className="flex gap-2">
            {Object.keys(PERIODOS).map((p) => (
              <Link
                key={p}
                href={`/relatorios?periodo=${p}`}
                className={`px-3 py-1 rounded-lg text-sm ${
                  p === periodo ? "bg-slate-900 text-white" : "bg-slate-100"
                }`}
              >
                {p}
              </Link>
            ))}
          </div>
        </div>

        <p className="text-3xl font-bold mb-4">R$ {totalGeral.toFixed(2)}</p>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b text-sm text-slate-500">
              <th className="py-2">Forma de pagamento</th>
              <th className="py-2">Qtd. vendas</th>
              <th className="py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {resumo.map((r) => (
              <tr key={r.forma_pagamento} className="border-b">
                <td className="py-2 capitalize">{r.forma_pagamento}</td>
                <td className="py-2">{r.quantidade}</td>
                <td className="py-2">R$ {r.total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-700 mb-3">Vendas do período</h2>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b text-sm text-slate-500">
              <th className="py-2">Data</th>
              <th className="py-2">Total</th>
              <th className="py-2">Pagamento</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {vendas.map((v) => (
              <tr key={v.id} className="border-b">
                <td className="py-2">{new Date(v.created_at).toLocaleString("pt-BR")}</td>
                <td className="py-2">R$ {v.total.toFixed(2)}</td>
                <td className="py-2 capitalize">
                  {v.forma_pagamento} {v.cancelada && <span className="text-red-600">(cancelada)</span>}
                </td>
                <td className="py-2">
                  <Link href={`/pdv/cupom/${v.id}`} className="text-slate-500 underline text-sm">
                    reimprimir
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-700 mb-3">Estoque completo</h2>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b text-sm text-slate-500">
              <th className="py-2">Produto</th>
              <th className="py-2">Quantidade</th>
              <th className="py-2">Mínimo</th>
            </tr>
          </thead>
          <tbody>
            {estoque.map((e) => (
              <tr key={e.produto_id} className="border-b">
                <td className="py-2">{e.nome}</td>
                <td className="py-2">{e.quantidade_atual}</td>
                <td className="py-2">{e.estoque_minimo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}