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
  HandCoins,
  Users,
  AlertOctagon,
  CalendarClock,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { buscarResumoDashboard } from "@/services/dashboard.service";
import { listarHistorico } from "@/services/historico.service";
import { listarContasPendentes, buscarResumoFinanceiro } from "@/services/contas-receber.service";
import { classificarUrgencia } from "@/lib/contas-receber/urgencia";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { StatusOperacional } from "@/components/dashboard/StatusOperacional";
import { exigirSessao } from "@/lib/auth/servidor";

const ATALHOS = [
  { href: "/pdv", titulo: "Nova venda", icone: ShoppingCart },
  { href: "/estoque", titulo: "Movimentar estoque", icone: Boxes },
  { href: "/produtos", titulo: "Cadastrar produto", icone: Tags },
  { href: "/relatorios", titulo: "Ver relatórios", icone: FileBarChart2 },
];

// Tema escuro só do dashboard: o "!" vence as classes claras dos componentes compartilhados (Card, Badge).
const CARD_ESCURO = "!bg-surface !border-surface-border";
const BADGE_ALERTA = "!text-brand-orange !bg-brand-orange/10 !border !border-brand-orange/30";
const BADGE_URGENCIA: Record<"success" | "warning" | "danger", string> = {
  success: "!bg-emerald-500/10 !text-emerald-400",
  warning: BADGE_ALERTA,
  danger: "!bg-red-500/10 !text-red-400",
};

function formatarMoeda(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Mesmo conteúdo do EmptyState compartilhado (claro), nas cores do dashboard escuro. */
function VazioEscuro({ icone: Icone, titulo }: { icone: LucideIcon; titulo: string }) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-4">
      <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
        <Icone className="w-6 h-6 text-brand-blue" />
      </div>
      <p className="font-medium text-zinc-300">{titulo}</p>
    </div>
  );
}

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await exigirSessao();
  const seteDiasAtras = new Date();
  seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
  seteDiasAtras.setHours(0, 0, 0, 0);

  const [resumo, historico, contasPendentes] = await Promise.all([
    buscarResumoDashboard(),
    listarHistorico(seteDiasAtras, new Date()),
    listarContasPendentes(),
  ]);
  const resumoFinanceiro = await buscarResumoFinanceiro(contasPendentes);

  const ticketMedio =
    resumo.quantidadeVendasHoje > 0 ? resumo.faturamentoHoje / resumo.quantidadeVendasHoje : 0;

  const ultimasMovimentacoes = historico.slice(0, 5);
  const maisUrgentes = contasPendentes.slice(0, 5);

  return (
    <div className="min-h-screen bg-[var(--bg-main)]">
    <main className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard</h1>
        <p className="text-zinc-400 text-sm">Visão geral de hoje</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard icone={DollarSign} rotulo="Faturamento hoje" valor={formatarMoeda(resumo.faturamentoHoje)} destaque />
        <KpiCard icone={ShoppingBag} rotulo="Vendas hoje" valor={String(resumo.quantidadeVendasHoje)} />
        <KpiCard icone={Receipt} rotulo="Ticket médio" valor={formatarMoeda(ticketMedio)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card className={CARD_ESCURO}>
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-brand-blue" />
              <h2 className="text-sm font-semibold text-zinc-300">Mais vendidos (30 dias)</h2>
            </div>
            {resumo.produtosMaisVendidos.length === 0 ? (
              <VazioEscuro icone={TrendingUp} titulo="Nenhuma venda registrada ainda" />
            ) : (
              <ol className="flex flex-col divide-y divide-surface-border">
                {resumo.produtosMaisVendidos.map((p, i) => (
                  <li key={p.produto_id} className="flex items-center justify-between text-sm py-2.5 first:pt-0 last:pb-0">
                    <span className="flex items-center gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 text-xs font-semibold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span className="text-white">{p.nome}</span>
                    </span>
                    <span className="text-zinc-400 font-medium">{p.quantidade_total} un.</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card className={CARD_ESCURO}>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-4 h-4 text-brand-orange" />
              <h2 className="text-sm font-semibold text-zinc-300">Estoque baixo</h2>
            </div>
            {resumo.produtosEstoqueBaixo.length === 0 ? (
              <VazioEscuro icone={Boxes} titulo="Nenhum produto abaixo do mínimo" />
            ) : (
              <ul className="flex flex-col divide-y divide-surface-border">
                {resumo.produtosEstoqueBaixo.map((p) => (
                  <li key={p.produto_id} className="flex items-center justify-between text-sm py-2.5 first:pt-0 last:pb-0">
                    <span className="text-white">{p.nome}</span>
                    <Badge variante="warning" className={BADGE_ALERTA}>
                      {p.quantidade_atual} un.
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className={CARD_ESCURO}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <HandCoins className="w-4 h-4 text-brand-blue" />
                <h2 className="text-sm font-semibold text-zinc-300">Contas a Receber</h2>
              </div>
              <Link href="/contas-receber" className="text-xs font-medium text-brand-blue hover:text-white transition-colors duration-150">
                Ver todas
              </Link>
            </div>

            <div className="flex items-baseline justify-between border-b border-surface-border pb-3 mb-3">
              <span className="text-zinc-400 text-sm">Valor total em aberto</span>
              <span className="text-2xl font-bold text-white tabular-nums">
                {formatarMoeda(resumoFinanceiro.valorTotalEmAberto)}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <Users className="w-3.5 h-3.5" />
                  Devedores
                </span>
                <span className="text-lg font-bold text-white">{resumoFinanceiro.quantidadeClientesDevedores}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <AlertOctagon className="w-3.5 h-3.5 text-red-400" />
                  Vencidas
                </span>
                <span className="text-lg font-bold text-red-400">{resumoFinanceiro.quantidadeContasVencidas}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <CalendarClock className="w-3.5 h-3.5 text-brand-orange" />
                  Perto de vencer
                </span>
                <span className="text-lg font-bold text-brand-orange">
                  {resumoFinanceiro.quantidadeContasProximasVencimento}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <Wallet className="w-3.5 h-3.5" />
                  Recebido hoje
                </span>
                <span className="text-lg font-bold text-white">{formatarMoeda(resumoFinanceiro.valorRecebidoHoje)}</span>
              </div>
            </div>

            <p className="text-xs text-zinc-400 mb-3">
              Recebido no mês: <strong className="text-zinc-200">{formatarMoeda(resumoFinanceiro.valorRecebidoNoMes)}</strong>
            </p>

            {contasPendentes.length === 0 ? (
              <VazioEscuro icone={HandCoins} titulo="Nenhuma conta em aberto" />
            ) : (
              <ul className="flex flex-col divide-y divide-surface-border border-t border-surface-border">
                {maisUrgentes.map((c) => {
                  const urgencia = classificarUrgencia(c.dias_em_aberto);
                  return (
                    <li key={c.id} className="flex items-center justify-between text-sm py-2.5">
                      <span className="text-white">{c.cliente_nome}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-zinc-400 font-medium">{formatarMoeda(c.saldo_atual)}</span>
                        <Badge variante={urgencia.variante} className={BADGE_URGENCIA[urgencia.variante]}>
                          {urgencia.rotulo}
                        </Badge>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <StatusOperacional />

          <Card className={CARD_ESCURO}>
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-brand-blue" />
              <h2 className="text-sm font-semibold text-zinc-300">Atalhos rápidos</h2>
            </div>
            <div className="flex flex-col gap-1">
              {ATALHOS.map((a) => {
                const Icone = a.icone;
                return (
                  <Link
                    key={a.href}
                    href={a.href}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-zinc-300 hover:bg-zinc-800/40 hover:text-white transition-colors duration-150"
                  >
                    <Icone className="w-4 h-4 text-brand-blue" />
                    {a.titulo}
                  </Link>
                );
              })}
            </div>
          </Card>

          <Card className={CARD_ESCURO}>
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-brand-blue" />
              <h2 className="text-sm font-semibold text-zinc-300">Últimas movimentações</h2>
            </div>
            {ultimasMovimentacoes.length === 0 ? (
              <VazioEscuro icone={Clock} titulo="Nenhuma operação recente" />
            ) : (
              <ul className="flex flex-col divide-y divide-surface-border">
                {ultimasMovimentacoes.map((e) => (
                  <li key={`${e.tipo}-${e.id}`} className="text-sm py-3 first:pt-0 last:pb-0">
                    <p className="text-white leading-snug">{e.descricao}</p>
                    <p className="text-zinc-500 text-xs mt-0.5">
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
    </div>
  );
}
