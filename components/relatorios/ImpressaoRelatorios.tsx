"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { VendaRelatorio, ResumoPorFormaPagamento } from "@/services/relatorios.service";
import type { EstoqueAtual } from "@/services/estoque.service";
import type { ContaReceberPendente } from "@/services/contas-receber.service";

interface ImpressaoRelatoriosProps {
  rotuloPeriodo: string;
  resumoPagamento: ResumoPorFormaPagamento[];
  totalGeral: number;
  vendas: VendaRelatorio[];
  estoque: EstoqueAtual[];
  contasFiadoPendentes: ContaReceberPendente[];
}

interface SelecaoImpressao {
  faturamento: boolean;
  vendas: boolean;
  estoque: boolean;
  fiado: boolean;
}

const PADRAO: SelecaoImpressao = { faturamento: true, vendas: true, estoque: true, fiado: true };

const OPCOES: { chave: keyof SelecaoImpressao; rotulo: string }[] = [
  { chave: "faturamento", rotulo: "Faturamento por forma de pagamento" },
  { chave: "vendas", rotulo: "Vendas do período" },
  { chave: "estoque", rotulo: "Estoque completo" },
  { chave: "fiado", rotulo: "Clientes fiado pendentes" },
];

export function ImpressaoRelatorios({
  rotuloPeriodo,
  resumoPagamento,
  totalGeral,
  vendas,
  estoque,
  contasFiadoPendentes,
}: ImpressaoRelatoriosProps) {
  const [escolhendo, setEscolhendo] = useState(false);
  const [selecao, setSelecao] = useState<SelecaoImpressao>(PADRAO);
  const geradoEm = new Date().toLocaleString("pt-BR");
  const totalFiadoPendente = contasFiadoPendentes.reduce((s, c) => s + c.saldo_atual, 0);

  function alternar(chave: keyof SelecaoImpressao) {
    setSelecao((s) => ({ ...s, [chave]: !s[chave] }));
  }

  function imprimir() {
    setEscolhendo(false);
    setTimeout(() => window.print(), 50);
  }

  return (
    <>
      <div className="no-print">
        <Button variante="secondary" tamanho="sm" onClick={() => setEscolhendo(true)}>
          <Printer className="w-3.5 h-3.5" />
          Imprimir Relatório
        </Button>
      </div>

      <Modal
        aberto={escolhendo}
        titulo="O que incluir na impressão?"
        onFechar={() => setEscolhendo(false)}
        rodape={
          <>
            <Button variante="secondary" tamanho="sm" onClick={() => setEscolhendo(false)}>
              Cancelar
            </Button>
            <Button tamanho="sm" onClick={imprimir}>
              Imprimir
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {OPCOES.map((item) => (
            <label key={item.chave} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={selecao[item.chave]}
                onChange={() => alternar(item.chave)}
                className="w-4 h-4 rounded border-slate-300"
              />
              {item.rotulo}
            </label>
          ))}
        </div>
      </Modal>

      <div className="print-only">
        <header className="flex items-center gap-4 border-b-2 border-slate-900 pb-4 mb-4">
          <img src="/logo-auto-posto-uniao.jpeg" alt="Auto Posto União" className="w-14 h-14 rounded object-cover" />
          <div>
            <p className="text-lg font-bold text-slate-900">Auto Posto União</p>
            <p className="text-base font-semibold text-slate-800">Relatório Geral</p>
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mb-6">
          <div className="flex gap-2">
            <dt className="font-medium text-slate-600">Período:</dt>
            <dd className="text-slate-900">{rotuloPeriodo}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium text-slate-600">Gerado em:</dt>
            <dd className="text-slate-900">{geradoEm}</dd>
          </div>
        </dl>

        {selecao.faturamento && (
          <section className="mb-6">
            <h3 className="text-sm font-bold text-slate-900 mb-1">Faturamento por forma de pagamento</h3>
            <p className="text-lg font-bold text-slate-900 mb-2">Total geral: R$ {totalGeral.toFixed(2)}</p>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-900 text-left">
                  <th className="py-1.5 pr-2">Forma de pagamento</th>
                  <th className="py-1.5 pr-2">Qtd. vendas</th>
                  <th className="py-1.5">Total</th>
                </tr>
              </thead>
              <tbody>
                {resumoPagamento.map((r) => (
                  <tr key={r.forma_pagamento} className="border-b border-slate-200">
                    <td className="py-1.5 pr-2 capitalize">{r.forma_pagamento}</td>
                    <td className="py-1.5 pr-2">{r.quantidade}</td>
                    <td className="py-1.5 font-semibold">R$ {r.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {selecao.vendas && (
          <section className="mb-6">
            <h3 className="text-sm font-bold text-slate-900 mb-2">Vendas do período ({vendas.length})</h3>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-900 text-left">
                  <th className="py-1.5 pr-2">Data</th>
                  <th className="py-1.5 pr-2">Total</th>
                  <th className="py-1.5">Pagamento</th>
                </tr>
              </thead>
              <tbody>
                {vendas.map((v) => (
                  <tr key={v.id} className="border-b border-slate-200">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{new Date(v.created_at).toLocaleString("pt-BR")}</td>
                    <td className="py-1.5 pr-2">R$ {v.total.toFixed(2)}</td>
                    <td className="py-1.5 capitalize">
                      {v.forma_pagamento}
                      {v.cancelada ? " (cancelada)" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {selecao.estoque && (
          <section className="mb-6">
            <h3 className="text-sm font-bold text-slate-900 mb-2">Estoque completo ({estoque.length})</h3>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-900 text-left">
                  <th className="py-1.5 pr-2">Produto</th>
                  <th className="py-1.5 pr-2">Quantidade</th>
                  <th className="py-1.5">Situação</th>
                </tr>
              </thead>
              <tbody>
                {estoque.map((e) => {
                  const baixo = e.quantidade_atual < e.estoque_minimo;
                  return (
                    <tr key={e.produto_id} className={`border-b border-slate-200 ${baixo ? "bg-slate-100" : ""}`}>
                      <td className="py-1.5 pr-2">{e.nome}</td>
                      <td className="py-1.5 pr-2 font-semibold">{e.quantidade_atual}</td>
                      <td className="py-1.5">{baixo ? `Estoque baixo (mín: ${e.estoque_minimo})` : "OK"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {selecao.fiado && (
          <section>
            <h3 className="text-sm font-bold text-slate-900 mb-1">
              Clientes fiado pendentes ({contasFiadoPendentes.length})
            </h3>
            <p className="text-lg font-bold text-slate-900 mb-2">Total a receber: R$ {totalFiadoPendente.toFixed(2)}</p>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-900 text-left">
                  <th className="py-1.5 pr-2">Cliente</th>
                  <th className="py-1.5 pr-2">Saldo devedor</th>
                  <th className="py-1.5 pr-2">Situação</th>
                  <th className="py-1.5">Dias em aberto</th>
                </tr>
              </thead>
              <tbody>
                {contasFiadoPendentes.map((c) => (
                  <tr
                    key={c.id}
                    className={`border-b border-slate-200 ${c.dias_em_aberto > 30 ? "bg-slate-100" : ""}`}
                  >
                    <td className="py-1.5 pr-2">{c.cliente_nome}</td>
                    <td className="py-1.5 pr-2 font-semibold">R$ {c.saldo_atual.toFixed(2)}</td>
                    <td className="py-1.5 pr-2 capitalize">{c.status === "PARCIAL" ? "Parcial" : "Em aberto"}</td>
                    <td className="py-1.5">{c.dias_em_aberto} dia(s)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </>
  );
}