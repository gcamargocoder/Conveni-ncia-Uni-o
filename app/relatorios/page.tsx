import Link from "next/link";
import { Receipt, ShoppingBag, Boxes, HandCoins, Filter } from "lucide-react";
import { LIMITE_TELA, listarTurnosParaFiltro, listarVendasDetalhadas, resumirPagamentos } from "@/services/relatorios.service";
import { listarTerminais } from "@/services/caixa-consulta.service";
import { listarFuncionarios } from "@/services/funcionarios.service";
import { PRESETS_PERIODO, ROTULOS_PRESET, ROTULO_SITUACAO, SITUACOES, lerFiltroVendas, paraQueryString, type ParametrosBrutos } from "@/lib/relatorios/filtro";
import { rotuloTerminal } from "@/lib/relatorios/planilha-vendas";
import { FORMAS_CAIXA, ROTULO_FORMA } from "@/lib/caixa/tipos";
import { BotaoExportarExcel } from "@/components/relatorios/BotaoExportarExcel";
import { listarEstoqueAtual } from "@/services/estoque.service";
import { listarContasPendentes } from "@/services/contas-receber.service";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { ImpressaoRelatorios } from "@/components/relatorios/ImpressaoRelatorios";
import { exigirSessao } from "@/lib/auth/servidor";
import { formatarData, formatarDataHora, instanteLocal } from "@/lib/utils/fuso";

export const dynamic = "force-dynamic";

const CAMPO = "h-11 w-full px-3 rounded-xl text-base bg-white border border-slate-300";
const ROTULO = "text-sm font-medium text-slate-700";

export default async function RelatoriosPage({ searchParams }: { searchParams: Promise<ParametrosBrutos> }) {
  const sessao = await exigirSessao();
  const params = await searchParams;
  const admin = sessao.usuario.papel === "admin";
  const { filtro, preset, avisos } = lerFiltroVendas(params);

  const [{ vendas, truncado }, estoque, contasPendentes, funcionarios, terminais, turnos] = await Promise.all([
    listarVendasDetalhadas(filtro, LIMITE_TELA),
    listarEstoqueAtual(),
    listarContasPendentes(),
    listarFuncionarios(),
    listarTerminais(),
    admin ? listarTurnosParaFiltro() : Promise.resolve([]),
  ]);

  // Faturamento por forma a partir dos PAGAMENTOS: venda dividida entra em cada forma, sem duplicar o total.
  const resumoFormas = resumirPagamentos(vendas, filtro.forma);
  const resumo = resumoFormas.map((l) => ({ forma_pagamento: l.forma, quantidade: l.quantidade_vendas, total: l.total_centavos / 100 }));
  const totalGeral = resumoFormas.reduce((s, r) => s + r.total_centavos, 0) / 100;
  const totalFiadoPendente = contasPendentes.reduce((s, c) => s + c.saldo_atual, 0);
  const vendasParaImpressao = vendas.map((v) => ({
    id: v.id,
    created_at: v.created_at,
    total: v.total,
    forma_pagamento: v.forma_pagamento,
    cancelada: v.cancelada,
  }));

  const dia = (d: string) => formatarData(instanteLocal(d, "12:00"));
  const rotuloPeriodo = preset
    ? ROTULOS_PRESET[preset]
    : `${dia(filtro.dataInicial)}${filtro.horaInicial ? ` ${filtro.horaInicial}` : ""} a ${dia(filtro.dataFinal)}${filtro.horaFinal ? ` ${filtro.horaFinal}` : ""}`;
  const consulta = paraQueryString(filtro);
  const rotuloTurno = (t: (typeof turnos)[number]) =>
    `${formatarDataHora(t.aberto_em)}${t.fechado_em ? ` → ${formatarDataHora(t.fechado_em)}` : " (aberto)"} · ${t.aberto_por} · ${rotuloTerminal(t.terminal_id, t.terminal_papel)}`;

  return (
    <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Relatórios</h1>
          <p className="text-slate-500 text-sm">Vendas e estoque por período — horário da loja (Brasília)</p>
        </div>
        <div className="flex items-center gap-2">
          <BotaoExportarExcel consulta={consulta} />
          <ImpressaoRelatorios
            rotuloPeriodo={rotuloPeriodo}
            resumoPagamento={resumo}
            totalGeral={totalGeral}
            vendas={vendasParaImpressao}
            estoque={estoque}
            contasFiadoPendentes={contasPendentes}
          />
        </div>
      </header>

      <Card className="no-print">
        <form method="get" action="/relatorios" className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-700">Filtros</h2>
            </div>
            <div className="flex gap-1.5">
              {Object.keys(PRESETS_PERIODO).map((p) => (
                <Link
                  key={p}
                  href={`/relatorios?periodo=${p}`}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    p === preset ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {ROTULOS_PRESET[p]}
                </Link>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={ROTULO}>Data inicial</span>
              <input className={CAMPO} type="date" name="de" defaultValue={filtro.dataInicial} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ROTULO}>Data final</span>
              <input className={CAMPO} type="date" name="ate" defaultValue={filtro.dataFinal} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ROTULO}>Horário inicial</span>
              <input className={CAMPO} type="time" name="hi" defaultValue={filtro.horaInicial ?? ""} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ROTULO}>Horário final</span>
              <input className={CAMPO} type="time" name="hf" defaultValue={filtro.horaFinal ?? ""} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ROTULO}>Funcionário</span>
              <select className={CAMPO} name="funcionario" defaultValue={filtro.funcionario_id ?? ""}>
                <option value="">Todos</option>
                {funcionarios.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ROTULO}>Terminal</span>
              <select className={CAMPO} name="terminal" defaultValue={filtro.terminal_id ?? ""}>
                <option value="">Todos</option>
                {terminais.map((t) => (
                  <option key={t.terminal_id} value={t.terminal_id}>
                    {rotuloTerminal(t.terminal_id, t.terminal_papel)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ROTULO}>Forma de pagamento</span>
              <select className={CAMPO} name="forma" defaultValue={filtro.forma ?? ""}>
                <option value="">Todas</option>
                {FORMAS_CAIXA.map((f) => (
                  <option key={f} value={f}>
                    {ROTULO_FORMA[f]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ROTULO}>Situação</span>
              <select className={CAMPO} name="situacao" defaultValue={filtro.situacao}>
                {SITUACOES.map((x) => (
                  <option key={x} value={x}>
                    {ROTULO_SITUACAO[x]}
                  </option>
                ))}
              </select>
            </label>
            {admin && (
              <label className="flex flex-col gap-1.5 col-span-2 lg:col-span-4">
                <span className={ROTULO}>Turno (caixa)</span>
                <select className={CAMPO} name="caixa" defaultValue={filtro.caixa_id ?? ""}>
                  <option value="">Todos</option>
                  {turnos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {rotuloTurno(t)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" className="h-11 px-5 rounded-xl text-sm font-semibold bg-brand-700 text-white hover:bg-brand-800">
              Filtrar
            </button>
            <Link href="/relatorios" className="text-sm text-slate-500 hover:underline">
              Limpar
            </Link>
          </div>
          {avisos.length > 0 && (
            <ul className="text-xs text-amber-700 list-disc pl-5">
              {avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </form>
      </Card>

      <Card className="no-print">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-amber-500" />
            <h2 className="text-sm font-semibold text-slate-700">Faturamento por forma de pagamento</h2>
          </div>
        </div>

        <p className="text-3xl font-bold text-slate-900 tabular-nums mb-4">R$ {totalGeral.toFixed(2)}</p>

        <Table
          colunas={[
            { chave: "forma_pagamento", cabecalho: "Forma de pagamento", render: (r) => ROTULO_FORMA[r.forma_pagamento] },
            { chave: "quantidade", cabecalho: "Qtd. vendas" },
            { chave: "total", cabecalho: "Total", render: (r) => `R$ ${r.total.toFixed(2)}` },
          ]}
          dados={resumo}
          chaveLinha={(r) => r.forma_pagamento}
          vazioIcone={Receipt}
          vazioModulo="contasReceber"
          vazioTitulo="Nenhuma venda no período"
        />
      </Card>

      <Card semPadding className="no-print">
        <div className="flex items-center gap-2 px-5 pt-5 mb-1">
          <ShoppingBag className="w-4 h-4 text-teal-500" />
          <h2 className="text-sm font-semibold text-slate-700">Vendas do período ({vendas.length})</h2>
        </div>
        {truncado && (
          <p className="px-5 text-xs text-amber-700">Mostrando as {LIMITE_TELA} vendas mais recentes. Refine os filtros; a planilha Excel traz o conjunto completo.</p>
        )}
        <Table
          colunas={[
            { chave: "created_at", cabecalho: "Data", render: (v) => formatarDataHora(v.created_at) },
            { chave: "funcionario_nome", cabecalho: "Funcionário" },
            { chave: "terminal", cabecalho: "Terminal", render: (v) => rotuloTerminal(v.terminal_id, v.terminal_papel) },
            { chave: "total", cabecalho: "Total", render: (v) => `R$ ${v.total.toFixed(2)}` },
            {
              chave: "forma_pagamento",
              cabecalho: "Pagamento",
              render: (v) => (
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    {v.forma_pagamento === "misto" ? "Dividido" : ROTULO_FORMA[v.forma_pagamento as keyof typeof ROTULO_FORMA] ?? v.forma_pagamento}
                    {v.cancelada && <Badge variante="danger">cancelada</Badge>}
                  </span>
                  {v.pagamentos.length > 1 && (
                    <span className="text-xs text-slate-500">
                      {v.pagamentos.map((p) => `${ROTULO_FORMA[p.forma]} R$ ${(p.valor_centavos / 100).toFixed(2)}`).join(" + ")}
                    </span>
                  )}
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
          vazioModulo="pdv"
          vazioTitulo="Nenhuma venda no período"
        />
      </Card>

      <Card semPadding className="no-print">
        <div className="flex items-center gap-2 px-5 pt-5 mb-1">
          <Boxes className="w-4 h-4 text-emerald-500" />
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
          vazioModulo="estoque"
          vazioTitulo="Nenhum produto cadastrado ainda"
        />
      </Card>

      <Card semPadding className="no-print">
        <div className="flex items-center justify-between px-5 pt-5 mb-1">
          <div className="flex items-center gap-2">
            <HandCoins className="w-4 h-4 text-amber-500" />
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
          vazioModulo="contasReceber"
          vazioTitulo="Nenhuma conta fiado em aberto"
        />
      </Card>
    </main>
  );
}