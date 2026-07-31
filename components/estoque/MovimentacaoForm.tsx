"use client";

import { useState } from "react";
import { TipoMovimentacao } from "@/types/estoque";
import { TIPOS_ENTRADA_MANUAL, exigeObservacao } from "@/lib/estoque/movimentacao";
import { registrarMovimentacaoAction } from "@/lib/estoque/actions";
import { PinInput } from "@/components/auth/PinInput";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/ToastProvider";

const ROTULOS: Record<TipoMovimentacao, string> = {
  entrada: "Entrada de mercadoria",
  perda: "Perda",
  ajuste_entrada: "Ajuste (a mais)",
  ajuste_saida: "Ajuste (a menos)",
  inventario: "Inventário",
  consumo_interno: "Consumo interno",
  venda: "Venda (automático)",
};

const CLASSES_CAMPO = "h-11 px-3 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600";

interface MovimentacaoFormProps {
  produtos: { id: string; nome: string }[];
  produtoFixo?: { id: string; nome: string };
  onSucesso?: () => void;
}

export function MovimentacaoForm({ produtos, produtoFixo, onSucesso }: MovimentacaoFormProps) {
  const [produtoId, setProdutoId] = useState(produtoFixo?.id ?? "");
  const [tipo, setTipo] = useState<TipoMovimentacao>("entrada");
  const [quantidade, setQuantidade] = useState(0);
  const [observacao, setObservacao] = useState("");
  const [pedindoPin, setPedindoPin] = useState(false);
  const { mostrar } = useToast();

  async function confirmarComPin(pin: string) {
    const resultado = await registrarMovimentacaoAction(
      { produto_id: produtoId, tipo, quantidade, observacao: observacao || null },
      pin
    );

    if (!resultado.sucesso) {
      throw new Error(resultado.erroGeral ?? resultado.erros?.[0]?.mensagem ?? "Erro ao registrar movimentação.");
    }

    if (!produtoFixo) setProdutoId("");
    setQuantidade(0);
    setObservacao("");
    onSucesso?.();
  }

  return (
    <div className="flex flex-col gap-4 max-w-md">
      {produtoFixo ? (
        <div>
          <p className="text-sm font-medium text-slate-700 mb-1">Produto</p>
          <p className="text-base text-slate-900 font-semibold">{produtoFixo.nome}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Produto</label>
          <select className={CLASSES_CAMPO} value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
            <option value="">Selecione...</option>
            {produtos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Tipo de movimentação</label>
        <select className={CLASSES_CAMPO} value={tipo} onChange={(e) => setTipo(e.target.value as TipoMovimentacao)}>
          {TIPOS_ENTRADA_MANUAL.map((t) => (
            <option key={t} value={t}>
              {ROTULOS[t]}
            </option>
          ))}
        </select>
      </div>

      <Input
        rotulo="Quantidade"
        type="number"
        value={quantidade}
        onChange={(e) => setQuantidade(Number(e.target.value))}
      />

      {exigeObservacao(tipo) && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">
            Observação (obrigatória para {ROTULOS[tipo].toLowerCase()})
          </label>
          <textarea
            className={`${CLASSES_CAMPO} h-24 py-2`}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />
        </div>
      )}

      <Button tamanho="lg" disabled={!produtoId || quantidade <= 0} onClick={() => setPedindoPin(true)}>
        Confirmar movimentação
      </Button>

      <Modal aberto={pedindoPin} titulo="Autorizar movimentação" onFechar={() => setPedindoPin(false)}>
        <p className="mb-4">Digite o PIN de quem está autorizando esta operação:</p>
        <PinInput
          modo="confirmacao"
          onPinCompleto={confirmarComPin}
          onSucesso={() => {
            setPedindoPin(false);
            mostrar("success", "Movimentação registrada.");
          }}
        />
      </Modal>
    </div>
  );
}