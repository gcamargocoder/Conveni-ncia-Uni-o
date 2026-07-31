import Link from "next/link";
import { Receipt, ShoppingBag, Boxes } from "lucide-react";
import { listarVendasPorPeriodo, resumirPorFormaPagamento } from "@/services/relatorios.service";
import { listarEstoqueAtual } from "@/services/estoque.service";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";

const PERIODOS: Record<string, number> = { hoje: 1, "7dias": 7, "30dias": 30 };
const ROTULOS_PERIODO: Record<string, string> = { hoje: "Hoje", "7dias": "7 dias", "30dias": "30 dias" };

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
    <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Relatórios</h1>
        <p className="text-slate-500 text-sm">Vendas e estoque por período</p>
      </header>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-brand-700" />
            <h2 className="text-sm font-semibold text-slate-700">Faturamento por forma de pagamento</h2>
          </div>
          <div className="flex gap-1.5">
            {Object.keys(PERIODOS).map((p) => (
              <Link
                key={p}
                href={`/relatorios?periodo=${p}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  p === periodo ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {ROTULOS_PERIODO[p]}
              </Link>
            ))}
          </div>
        </div>

        <p className="text-3xl font-bold text-slate-900 tabular-nums mb-4">R$ {totalGeral.toFixed(2)}</p>

        <Table
          colunas={[
            { chave: "forma_pagamento", cabecalho: "Forma de pagamento", className: "capitalize" },
            { chave: "quantidade", cabecalho: "Qtd. vendas" },
            { chave: "total", cabecalho: "Total", render: (r) => `R$ ${r.total.toFixed(2)}` },
          ]}
          dados={resumo}
          chaveLinha={(r) => r.forma_pagamento}
          vazioIcone={Receipt}
          vazioTitulo="Nenhuma venda no período"
        />
      </Card>

      <Card semPadding>
        <div className="flex items-center gap-2 px-5 pt-5 mb-1">
          <ShoppingBag className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Vendas do período</h2>
        </div>
        <Table
          colunas={[
            { chave: "created_at", cabecalho: "Data", render: (v) => new Date(v.created_at).toLocaleString("pt-BR") },
            { chave: "total", cabecalho: "Total", render: (v) => `R$ ${v.total.toFixed(2)}` },
            {
              chave: "forma_pagamento",
              cabecalho: "Pagamento",
              render: (v) => (
                <span className="flex items-center gap-2 capitalize">
                  {v.forma_pagamento}
                  {v.cancelada && <Badge variante="danger">cancelada</Badge>}
                </span>
              ),
            },
            {
              chave: "acoes",
              cabecalho: "",
              render: (v) => (
                <Link href={`/pdv/cupom/${v.id}`} className="text-brand-700 hover:underline text-sm font-medium">
                  Reimprimir
                </Link>
              ),
            },
          ]}
          dados={vendas}
          chaveLinha={(v) => v.id}
          vazioIcone={ShoppingBag}
          vazioTitulo="Nenhuma venda no período"
        />
      </Card>

      <Card semPadding>
        <div className="flex items-center gap-2 px-5 pt-5 mb-1">
          <Boxes className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Estoque completo</h2>
        </div>
        <Table
          colunas={[
            { chave: "nome", cabecalho: "Produto" },
            {
              chave: "quantidade_atual",
              cabecalho: "Quantidade",
              render: (e) => (
                <span className="text-base font-semibold text-slate-900 tabular-nums">{e.quantidade_atual}</span>
              ),
            },
            {
              chave: "situacao",
              cabecalho: "Situação",
              render: (e) =>
                e.quantidade_atual < e.estoque_minimo ? (
                  <Badge variante="warning">Estoque baixo (mín: {e.estoque_minimo})</Badge>
                ) : (
                  <span className="text-slate-400 text-xs">OK</span>
                ),
            },
          ]}
          dados={estoque}
          chaveLinha={(e) => e.produto_id}
          vazioIcone={Boxes}
          vazioTitulo="Nenhum produto cadastrado ainda"
        />
      </Card>
    </main>
  );
}