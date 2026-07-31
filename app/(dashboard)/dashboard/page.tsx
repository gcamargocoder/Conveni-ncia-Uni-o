import Link from "next/link";
import {
  DollarSign,
  ShoppingBag,
  Receipt,
  TrendingUp,
  AlertTriangle,
  Zap,
  Clock,
  ShoppingCart,
  Boxes,
  Tags,
  FileBarChart2,
} from "lucide-react";
import { buscarResumoDashboard } from "@/services/dashboard.service";
import { listarHistorico } from "@/services/historico.service";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { StatusOperacional } from "@/components/dashboard/StatusOperacional";

const ATALHOS = [
  { href: "/pdv", titulo: "Nova venda", icone: ShoppingCart },
  { href: "/estoque", titulo: "Movimentar estoque", icone: Boxes },
  { href: "/produtos", titulo: "Cadastrar produto", icone: Tags },
  { href: "/relatorios", titulo: "Ver relatórios", icone: FileBarChart2 },
];

function formatarMoeda(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function DashboardPage() {
  const [resumo, historico] = await Promise.all([buscarResumoDashboard(), listarHistorico(7)]);

  // Ticket médio: computado aqui na apresentação, sem tocar em
  // nenhum serviço — a Etapa 7 proíbe alterar regra de negócio.
  const ticketMedio =
    resumo.quantidadeVendasHoje > 0 ? resumo.faturamentoHoje / resumo.quantidadeVendasHoje : 0;

  const ultimasMovimentacoes = historico.slice(0, 5);

  return (
    <main className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm">Visão geral de hoje</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard icone={DollarSign} rotulo="Faturamento hoje" valor={formatarMoeda(resumo.faturamentoHoje)} destaque />
        <KpiCard icone={ShoppingBag} rotulo="Vendas hoje" valor={String(resumo.quantidadeVendasHoje)} />
        <KpiCard icone={Receipt} rotulo="Ticket médio" valor={formatarMoeda(ticketMedio)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-brand-700" />
              <h2 className="text-sm font-semibold text-slate-700">Mais vendidos (30 dias)</h2>
            </div>
            {resumo.produtosMaisVendidos.length === 0 ? (
              <EmptyState icone={TrendingUp} titulo="Nenhuma venda registrada ainda" />
            ) : (
              <ol className="flex flex-col gap-2.5">
                {resumo.produtosMaisVendidos.map((p, i) => (
                  <li key={p.produto_id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-xs font-semibold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span className="text-slate-700">{p.nome}</span>
                    </span>
                    <span className="text-slate-500 font-medium">{p.quantidade_total} un.</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-4 h-4 text-warning-600" />
              <h2 className="text-sm font-semibold text-slate-700">Estoque baixo</h2>
            </div>
            {resumo.produtosEstoqueBaixo.length === 0 ? (
              <EmptyState icone={Boxes} titulo="Nenhum produto abaixo do mínimo" />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {resumo.produtosEstoqueBaixo.map((p) => (
                  <li key={p.produto_id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{p.nome}</span>
                    <Badge variante="warning">{p.quantidade_atual} un.</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <StatusOperacional />

          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-brand-700" />
              <h2 className="text-sm font-semibold text-slate-700">Atalhos rápidos</h2>
            </div>
            <div className="flex flex-col gap-1">
              {ATALHOS.map((a) => {
                const Icone = a.icone;
                return (
                  <Link
                    key={a.href}
                    href={a.href}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <Icone className="w-4 h-4 text-brand-700" />
                    {a.titulo}
                  </Link>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-brand-700" />
              <h2 className="text-sm font-semibold text-slate-700">Últimas movimentações</h2>
            </div>
            {ultimasMovimentacoes.length === 0 ? (
              <EmptyState icone={Clock} titulo="Nenhuma operação recente" />
            ) : (
              <ul className="flex flex-col gap-3">
                {ultimasMovimentacoes.map((e) => (
                  <li key={`${e.tipo}-${e.id}`} className="text-sm">
                    <p className="text-slate-700 leading-snug">{e.descricao}</p>
                    <p className="text-slate-400 text-xs mt-0.5">
                      {e.funcionario_nome} · {new Date(e.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}