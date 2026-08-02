import Link from "next/link";
import { Receipt, ShoppingBag, Boxes, HandCoins } from "lucide-react";
import { listarVendasPorPeriodo, resumirPorFormaPagamento } from "@/services/relatorios.service";
import { listarEstoqueAtual } from "@/services/estoque.service";
import { listarContasPendentes } from "@/services/contas-receber.service";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { ImpressaoRelatorios } from "@/components/relatorios/ImpressaoRelatorios";

export const dynamic = "force-dynamic";

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

  const [vendas, estoque, contasPendentes] = await Promise.all([
    listarVendasPorPeriodo(inicio, fim),
    listarEstoqueAtual(),
    listarContasPendentes(),
  ]);

  const resumo = resumirPorFormaPagamento(vendas);
  const totalGeral = resumo.reduce((s, r) => s + r.total, 0);
  const totalFiadoPendente = contasPendentes.reduce((s, c) => s + c.saldo_atual, 0);

  return (
    <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Relatórios</h1>
          <p className="text-slate-500 text-sm">Vendas e estoque por período</p>
        </div>
        <ImpressaoRelatorios
          rotuloPeriodo={ROTULOS_PERIODO[periodo] ?? "7 dias"}
          resumoPagamento={resumo}
          totalGeral={totalGeral}
          vendas={vendas}
          estoque={estoque}
          contasFiadoPendentes={contasPendentes}
        />
      </header>

      <Card className="no-print">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
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

      <Card semPadding className="no-print">
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

      <Card semPadding className="no-print">
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

      <Card semPadding className="no-print">
        <div className="flex items-center justify-between px-5 pt-5 mb-1">
          <div className="flex items-center gap-2">
            <HandCoins className="w-4 h-4 text-brand-700" />
            <h2 className="text-sm font-semibold text-slate-700">
              Clientes fiado pendentes — total R$ {totalFiadoPendente.toFixed(2)}
            </h2>
          </div>
          <Link href="/contas-receber" className="text-xs font-medium text-brand-700 hover:underline">
            Ver todas
          </Link>
        </div>
        <Table
          colunas={[
            { chave: "cliente_nome", cabecalho: "Cliente" },
            {
              chave: "saldo_atual",
              cabecalho: "Saldo devedor",
              render: (c) => (
                <span className="font-semibold text-slate-900 tabular-nums">R$ {c.saldo_atual.toFixed(2)}</span>
              ),
            },
            {
              chave: "status",
              cabecalho: "Situação",
              render: (c) => (
                <Badge variante="warning">{c.status === "PARCIAL" ? "Parcial" : "Em aberto"}</Badge>
              ),
            },
            {
              chave: "dias_em_aberto",
              cabecalho: "Dias em aberto",
              render: (c) => (
                <Badge variante={c.dias_em_aberto > 30 ? "danger" : "neutral"}>{c.dias_em_aberto} dia(s)</Badge>
              ),
            },
          ]}
          dados={contasPendentes}
          chaveLinha={(c) => c.id}
          vazioIcone={HandCoins}
          vazioTitulo="Nenhuma conta fiado em aberto"
        />
      </Card>
    </main>
  );
}