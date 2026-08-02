"use client";

import { useState, useMemo } from "react";
import { Search, Printer, Users } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { DetalheClienteModal } from "./DetalheClienteModal";
import { classificarUrgencia, type NivelUrgencia } from "@/lib/contas-receber/urgencia";
import type { Devedor } from "@/services/contas-receber.service";
import type { StatusConta } from "@/types/conta-receber";

interface ListaDevedoresProps {
  devedores: Devedor[];
}

type FiltroStatus = "todos" | StatusConta;
type FiltroUrgencia = "todos" | NivelUrgencia;
type Ordenacao = "maior_divida" | "menor_divida" | "mais_antigo" | "mais_recente";

const FILTROS_STATUS: { valor: FiltroStatus; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "ABERTA", rotulo: "Em aberto" },
  { valor: "PARCIAL", rotulo: "Parcial" },
  { valor: "QUITADA", rotulo: "Quitados" },
];

const FILTROS_URGENCIA: { valor: FiltroUrgencia; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "verde", rotulo: "Até 15 dias" },
  { valor: "amarelo", rotulo: "16–30 dias" },
  { valor: "vermelho", rotulo: "Acima de 30 dias" },
];

const OPCOES_ORDENACAO: { valor: Ordenacao; rotulo: string }[] = [
  { valor: "maior_divida", rotulo: "Maior dívida" },
  { valor: "menor_divida", rotulo: "Menor dívida" },
  { valor: "mais_antigo", rotulo: "Mais antigo" },
  { valor: "mais_recente", rotulo: "Mais recente" },
];

const ROTULOS_STATUS: Record<StatusConta, { texto: string; variante: "warning" | "success" | "neutral" }> = {
  ABERTA: { texto: "Em aberto", variante: "warning" },
  PARCIAL: { texto: "Parcial", variante: "warning" },
  QUITADA: { texto: "Quitado", variante: "success" },
};

export function ListaDevedores({ devedores }: ListaDevedoresProps) {
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const [filtroUrgencia, setFiltroUrgencia] = useState<FiltroUrgencia>("todos");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("maior_divida");
  const [clienteAberto, setClienteAberto] = useState<string | null>(null);

  const filtradoEOrdenado = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    let lista = devedores.filter((d) => {
      if (termo && !d.cliente_nome.toLowerCase().includes(termo)) return false;
      if (filtroStatus !== "todos" && d.status !== filtroStatus) return false;
      if (filtroUrgencia !== "todos" && classificarUrgencia(d.dias_em_aberto).nivel !== filtroUrgencia) return false;
      return true;
    });

    lista = [...lista].sort((a, b) => {
      switch (ordenacao) {
        case "maior_divida":
          return b.saldo_atual - a.saldo_atual;
        case "menor_divida":
          return a.saldo_atual - b.saldo_atual;
        case "mais_antigo":
          return new Date(a.primeira_compra_em_aberto).getTime() - new Date(b.primeira_compra_em_aberto).getTime();
        case "mais_recente":
          return new Date(b.ultima_compra).getTime() - new Date(a.ultima_compra).getTime();
      }
    });

    return lista;
  }, [devedores, busca, filtroStatus, filtroUrgencia, ordenacao]);

  const totalFiltrado = filtradoEOrdenado.reduce((s, d) => s + d.saldo_atual, 0);

  function imprimir() {
    window.print();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col gap-3 px-5 pt-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              placeholder="Procurar por cliente..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full h-11 pl-10 pr-3 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600"
            />
          </div>
          <select
            value={ordenacao}
            onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
            className="h-11 px-3 rounded-lg text-sm bg-white border border-slate-300 focus:border-brand-600"
          >
            {OPCOES_ORDENACAO.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
          <Button variante="secondary" tamanho="sm" onClick={imprimir}>
            <Printer className="w-3.5 h-3.5" />
            Imprimir Relatório
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs font-medium text-slate-400 self-center mr-1">Status:</span>
          {FILTROS_STATUS.map((f) => (
            <button
              key={f.valor}
              onClick={() => setFiltroStatus(f.valor)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filtroStatus === f.valor ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {f.rotulo}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs font-medium text-slate-400 self-center mr-1">Urgência:</span>
          {FILTROS_URGENCIA.map((f) => (
            <button
              key={f.valor}
              onClick={() => setFiltroUrgencia(f.valor)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filtroUrgencia === f.valor
                  ? "bg-brand-700 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="no-print">
        <Table
          colunas={[
            { chave: "cliente_nome", cabecalho: "Cliente" },
            { chave: "cliente_telefone", cabecalho: "Telefone", render: (d) => d.cliente_telefone ?? "—" },
            {
              chave: "primeira_compra_em_aberto",
              cabecalho: "1ª compra em aberto",
              render: (d) => new Date(d.primeira_compra_em_aberto).toLocaleDateString("pt-BR"),
            },
            {
              chave: "ultima_compra",
              cabecalho: "Última compra",
              render: (d) => new Date(d.ultima_compra).toLocaleDateString("pt-BR"),
            },
            {
              chave: "saldo_atual",
              cabecalho: "Saldo atual",
              render: (d) => (
                <span className="font-semibold text-slate-900 tabular-nums">R$ {d.saldo_atual.toFixed(2)}</span>
              ),
            },
            {
              chave: "dias_em_aberto",
              cabecalho: "Dias em aberto",
              render: (d) =>
                d.status === "QUITADA" ? (
                  <span className="text-slate-400 text-xs">—</span>
                ) : (
                  <Badge variante={classificarUrgencia(d.dias_em_aberto).variante}>
                    {classificarUrgencia(d.dias_em_aberto).rotulo}
                  </Badge>
                ),
            },
            {
              chave: "status",
              cabecalho: "Status",
              render: (d) => <Badge variante={ROTULOS_STATUS[d.status].variante}>{ROTULOS_STATUS[d.status].texto}</Badge>,
            },
            {
              chave: "acoes",
              cabecalho: "",
              render: (d) => (
                <button
                  onClick={() => setClienteAberto(d.cliente_id)}
                  className="text-brand-700 hover:underline text-sm font-medium"
                >
                  Ver detalhes
                </button>
              ),
            },
          ]}
          dados={filtradoEOrdenado}
          chaveLinha={(d) => d.cliente_id}
          vazioIcone={Users}
          vazioTitulo={busca || filtroStatus !== "todos" || filtroUrgencia !== "todos" ? "Nenhum cliente encontrado" : "Nenhum cliente fiado ainda"}
        />
      </div>

      <div className="print-only">
        <header className="flex items-center gap-4 border-b-2 border-slate-900 pb-4 mb-4">
          <img src="/logo-auto-posto-uniao.jpeg" alt="Auto Posto União" className="w-14 h-14 rounded object-cover" />
          <div>
            <p className="text-lg font-bold text-slate-900">Auto Posto União</p>
            <p className="text-base font-semibold text-slate-800">Relatório de Contas a Receber</p>
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mb-4">
          <div className="flex gap-2">
            <dt className="font-medium text-slate-600">Gerado em:</dt>
            <dd className="text-slate-900">{new Date().toLocaleString("pt-BR")}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium text-slate-600">Clientes listados:</dt>
            <dd className="text-slate-900">{filtradoEOrdenado.length}</dd>
          </div>
        </dl>

        <p className="text-lg font-bold text-slate-900 mb-3">Total do saldo listado: R$ {totalFiltrado.toFixed(2)}</p>

        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-900 text-left">
              <th className="py-1.5 pr-2">Nome</th>
              <th className="py-1.5 pr-2">Telefone</th>
              <th className="py-1.5 pr-2">Saldo</th>
              <th className="py-1.5 pr-2">Dias em aberto</th>
              <th className="py-1.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtradoEOrdenado.map((d) => {
              const urgencia = classificarUrgencia(d.dias_em_aberto);
              const destaque = urgencia.nivel === "vermelho";
              return (
                <tr key={d.cliente_id} className={`border-b border-slate-200 ${destaque ? "bg-slate-100" : ""}`}>
                  <td className="py-1.5 pr-2">{d.cliente_nome}</td>
                  <td className="py-1.5 pr-2">{d.cliente_telefone ?? "—"}</td>
                  <td className="py-1.5 pr-2 font-semibold">R$ {d.saldo_atual.toFixed(2)}</td>
                  <td className="py-1.5 pr-2">{d.status === "QUITADA" ? "—" : `${d.dias_em_aberto} dia(s)`}</td>
                  <td className="py-1.5">{ROTULOS_STATUS[d.status].texto}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <DetalheClienteModal clienteId={clienteAberto} onFechar={() => setClienteAberto(null)} />
    </div>
  );
}