"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { RegistrarPagamentoModal } from "./RegistrarPagamentoModal";
import { buscarContaAction } from "@/lib/contas-receber/actions";
import type { DetalheContaReceber } from "@/services/contas-receber.service";

interface DetalheContaModalProps {
  contaId: string | null;
  onFechar: () => void;
}

const ROTULOS_STATUS: Record<string, { texto: string; variante: "warning" | "success" | "neutral" }> = {
  ABERTA: { texto: "Em aberto", variante: "warning" },
  PARCIAL: { texto: "Parcial", variante: "warning" },
  QUITADA: { texto: "Quitada", variante: "success" },
};

export function DetalheContaModal({ contaId, onFechar }: DetalheContaModalProps) {
  const [detalhe, setDetalhe] = useState<DetalheContaReceber | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [registrandoPagamento, setRegistrandoPagamento] = useState(false);

  async function carregar() {
    if (!contaId) return;
    setCarregando(true);
    const resultado = await buscarContaAction(contaId);
    setDetalhe(resultado);
    setCarregando(false);
  }

  useEffect(() => {
    if (contaId) carregar();
    else setDetalhe(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contaId]);

  const status = detalhe ? ROTULOS_STATUS[detalhe.conta.status] : null;

  return (
    <>
      <Modal aberto={!!contaId} titulo="Detalhe da conta" onFechar={onFechar}>
        {carregando && <p className="text-sm text-slate-500 py-6 text-center">Carregando...</p>}

        {!carregando && !detalhe && contaId && (
          <p className="text-sm text-slate-500 py-6 text-center">Não foi possível carregar esta conta.</p>
        )}

        {!carregando && detalhe && (
          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Cliente</h3>
              <p className="font-semibold text-slate-900">{detalhe.cliente.nome}</p>
              {detalhe.cliente.telefone && <p className="text-sm text-slate-500">{detalhe.cliente.telefone}</p>}
            </section>

            <section className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Venda</h3>
              <p className="text-sm text-slate-700">
                {new Date(detalhe.conta.venda_created_at).toLocaleString("pt-BR")}
              </p>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-500">Valor original</p>
                <p className="font-semibold text-slate-900">R$ {detalhe.conta.valor_original.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Saldo atual</p>
                <p className="font-bold text-lg text-slate-900">R$ {detalhe.conta.saldo_atual.toFixed(2)}</p>
              </div>
            </section>

            {status && <Badge variante={status.variante}>{status.texto}</Badge>}

            <div className="border-t border-slate-100" />

            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Pagamentos</h3>
              {detalhe.pagamentos.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum pagamento registrado ainda.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-slate-50">
                  {detalhe.pagamentos.map((p) => (
                    <li key={p.id} className="py-2 flex justify-between text-sm">
                      <div>
                        <p className="text-slate-800 font-medium">R$ {p.valor.toFixed(2)}</p>
                        <p className="text-slate-500 text-xs capitalize">{p.forma_pagamento}</p>
                        {p.observacoes && <p className="text-slate-500 text-xs">{p.observacoes}</p>}
                      </div>
                      <p className="text-slate-400 text-xs">{new Date(p.created_at).toLocaleDateString("pt-BR")}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {detalhe.conta.status !== "QUITADA" && (
              <Button onClick={() => setRegistrandoPagamento(true)}>Registrar pagamento</Button>
            )}
          </div>
        )}
      </Modal>

      {detalhe && (
        <RegistrarPagamentoModal
          aberto={registrandoPagamento}
          contaReceberId={detalhe.conta.id}
          saldoAtual={detalhe.conta.saldo_atual}
          onFechar={() => setRegistrandoPagamento(false)}
          onSucesso={() => {
            setRegistrandoPagamento(false);
            carregar();
          }}
        />
      )}
    </>
  );
}