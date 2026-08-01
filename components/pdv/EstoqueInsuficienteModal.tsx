"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export interface PendenciaEstoque {
  produtoId: string;
  nome: string;
  quantidadeSolicitada: number;
  quantidadeDisponivel: number;
}

interface EstoqueInsuficienteModalProps {
  pendencia: PendenciaEstoque | null;
  onAjustar: () => void;
  onCancelar: () => void;
}

export function EstoqueInsuficienteModal({ pendencia, onAjustar, onCancelar }: EstoqueInsuficienteModalProps) {
  if (!pendencia) return null;

  const semEstoque = pendencia.quantidadeDisponivel <= 0;

  return (
    <Modal
      aberto={!!pendencia}
      titulo="Estoque insuficiente"
      onFechar={onCancelar}
      rodape={
        <>
          <Button variante="secondary" tamanho="sm" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button variante="primary" tamanho="sm" onClick={onAjustar}>
            {semEstoque ? "Remover item" : `Ajustar para ${pendencia.quantidadeDisponivel}`}
          </Button>
        </>
      }
    >
      <p className="font-semibold text-slate-900">{pendencia.nome}</p>
      <dl className="mt-2 flex flex-col gap-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-slate-500">Quantidade disponível</dt>
          <dd className="font-medium text-slate-900">{pendencia.quantidadeDisponivel} un.</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-slate-500">Você informou</dt>
          <dd className="font-medium text-slate-900">{pendencia.quantidadeSolicitada} un.</dd>
        </div>
      </dl>
      <p className="mt-3 text-sm text-slate-500">
        {semEstoque
          ? "Não há estoque registrado para este produto."
          : `Deseja ajustar automaticamente para ${pendencia.quantidadeDisponivel} unidade(s)?`}
      </p>
    </Modal>
  );
}