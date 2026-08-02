"use client";

import { useState, useEffect } from "react";
import { ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { DetalheContaModal } from "./DetalheContaModal";
import { buscarDetalheClienteAction } from "@/lib/contas-receber/actions";
import { classificarUrgencia } from "@/lib/contas-receber/urgencia";
import type { DetalheCliente } from "@/services/contas-receber.service";

interface DetalheClienteModalProps {
  clienteId: string | null;
  onFechar: () => void;
}

export function DetalheClienteModal({ clienteId, onFechar }: DetalheClienteModalProps) {
  const [detalhe, setDetalhe] = useState<DetalheCliente | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [contaAberta, setContaAberta] = useState<string | null>(null);

  async function carregar() {
    if (!clienteId) return;
    setCarregando(true);
    const resultado = await buscarDetalheClienteAction(clienteId);
    setDetalhe(resultado);
    setCarregando(false);
  }

  useEffect(() => {
    if (clienteId) carregar();
    else setDetalhe(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId]);

  return (
    <>
      <Modal aberto={!!clienteId} titulo="Detalhe do cliente" onFechar={onFechar}>
        {carregando && <p className="text-sm text-slate-500 py-6 text-center">Carregando...</p>}

        {!carregando && !detalhe && clienteId && (
          <p className="text-sm text-slate-500 py-6 text-center">Não foi possível carregar este cliente.</p>
        )}

        {!carregando && detalhe && (
          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Cliente</h3>
              <p className="font-semibold text-slate-900 text-lg">{detalhe.cliente.nome}</p>
              {detalhe.cliente.telefone && <p className="text-sm text-slate-500">{detalhe.cliente.telefone}</p>}
              {detalhe.cliente.observacoes && (
                <p className="text-xs text-slate-400 mt-1">{detalhe.cliente.observacoes}</p>
              )}
            </section>

            <div className="flex items-baseline justify-between border-y border-slate-100 py-3">
              <span className="text-slate-500 text-sm">Saldo total em aberto</span>
              <span className="text-2xl font-bold text-slate-900 tabular-nums">
                R$ {detalhe.saldoTotal.toFixed(2)}
              </span>
            </div>

            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Compras em aberto ({detalhe.comprasEmAberto.length})
              </h3>
              {detalhe.comprasEmAberto.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma compra em aberto.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-slate-50">
                  {detalhe.comprasEmAberto.map((c) => {
                    const dias = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000);
                    const urgencia = classificarUrgencia(dias);
                    return (
                      <li key={c.id}>
                        <button
                          onClick={() => setContaAberta(c.id)}
                          className="w-full flex items-center justify-between gap-2 py-2.5 text-left hover:bg-slate-50 rounded-lg px-1 -mx-1 transition-colors"
                        >
                          <div>
                            <p className="text-sm font-medium text-slate-800">
                              {new Date(c.venda_created_at).toLocaleDateString("pt-BR")}
                            </p>
                            <p className="text-xs text-slate-500">Saldo: R$ {c.saldo_atual.toFixed(2)}</p>
                          </div>
                          <Badge variante={urgencia.variante}>{urgencia.rotulo}</Badge>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <div className="border-t border-slate-100" />

            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Compras quitadas ({detalhe.comprasQuitadas.length})
              </h3>
              {detalhe.comprasQuitadas.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma compra quitada ainda.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-slate-50">
                  {detalhe.comprasQuitadas.map((c) => (
                    <li key={c.id} className="py-2 flex justify-between text-sm">
                      <span className="text-slate-700">{new Date(c.venda_created_at).toLocaleDateString("pt-BR")}</span>
                      <span className="text-slate-500">R$ {c.valor_original.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="border-t border-slate-100" />

            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Pagamentos ({detalhe.pagamentos.length})
              </h3>
              {detalhe.pagamentos.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum pagamento registrado ainda.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-slate-50">
                  {detalhe.pagamentos.map((p) => (
                    <li key={p.id} className="py-2 flex justify-between text-sm">
                      <div>
                        <p className="text-slate-800 font-medium">R$ {p.valor.toFixed(2)}</p>
                        <p className="text-slate-500 text-xs capitalize">{p.forma_pagamento}</p>
                      </div>
                      <p className="text-slate-400 text-xs">{new Date(p.created_at).toLocaleDateString("pt-BR")}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="border-t border-slate-100" />

            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Linha do tempo</h3>
              {detalhe.linhaDoTempo.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum evento registrado ainda.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {detalhe.linhaDoTempo.map((evento, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          evento.tipo === "compra" ? "bg-slate-100" : "bg-success-50"
                        }`}
                      >
                        {evento.tipo === "compra" ? (
                          <ArrowUpRight className="w-3.5 h-3.5 text-slate-500" />
                        ) : (
                          <ArrowDownLeft className="w-3.5 h-3.5 text-success-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-800">{evento.descricao}</p>
                        <p className="text-slate-400 text-xs">{new Date(evento.data).toLocaleString("pt-BR")}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Modal>

      <DetalheContaModal
        contaId={contaAberta}
        onFechar={() => {
          setContaAberta(null);
          carregar();
        }}
      />
    </>
  );
}