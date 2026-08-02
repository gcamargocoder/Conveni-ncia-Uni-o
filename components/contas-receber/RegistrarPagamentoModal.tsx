"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { PinInput } from "@/components/auth/PinInput";
import { useToast } from "@/components/ui/ToastProvider";
import { registrarPagamentoAction } from "@/lib/contas-receber/actions";
import { validarPagamento } from "@/lib/contas-receber/validacao";

const FORMAS = [
  { valor: "dinheiro", rotulo: "Dinheiro" },
  { valor: "pix", rotulo: "PIX" },
  { valor: "debito", rotulo: "Débito" },
  { valor: "credito", rotulo: "Crédito" },
];

interface RegistrarPagamentoModalProps {
  aberto: boolean;
  contaReceberId: string;
  saldoAtual: number;
  onFechar: () => void;
  onSucesso: () => void;
}

export function RegistrarPagamentoModal({
  aberto,
  contaReceberId,
  saldoAtual,
  onFechar,
  onSucesso,
}: RegistrarPagamentoModalProps) {
  const [valor, setValor] = useState(0);
  const [formaPagamento, setFormaPagamento] = useState("dinheiro");
  const [observacoes, setObservacoes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pedindoPin, setPedindoPin] = useState(false);
  const { mostrar } = useToast();

  function aoClicarRegistrar() {
    const erros = validarPagamento({ valor, formaPagamento, observacoes }, saldoAtual);
    if (erros.length > 0) {
      setErro(erros[0].mensagem);
      return;
    }
    setErro(null);
    setPedindoPin(true);
  }

  async function confirmarComPin(pin: string) {
    const resultado = await registrarPagamentoAction(
      contaReceberId,
      { valor, formaPagamento, observacoes },
      saldoAtual,
      pin
    );

    if (!resultado.sucesso) {
      throw new Error(resultado.erro ?? "Erro ao registrar pagamento.");
    }

    setValor(0);
    setObservacoes("");
    mostrar("success", "Pagamento registrado.");
    onSucesso();
  }

  return (
    <>
      <Modal aberto={aberto} titulo="Registrar pagamento" onFechar={onFechar}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-500">
            Saldo devedor atual: <strong className="text-slate-900">R$ {saldoAtual.toFixed(2)}</strong>
          </p>

          <Input
            rotulo="Valor"
            type="number"
            step="0.01"
            value={valor}
            onChange={(e) => setValor(Number(e.target.value))}
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Forma de pagamento</label>
            <select
              className="h-11 px-3 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600"
              value={formaPagamento}
              onChange={(e) => setFormaPagamento(e.target.value)}
            >
              {FORMAS.map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.rotulo}
                </option>
              ))}
            </select>
          </div>

          <Input rotulo="Observação (opcional)" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />

          {erro && <Alert variante="danger">{erro}</Alert>}

          <Button tamanho="lg" disabled={valor <= 0} onClick={aoClicarRegistrar}>
            Registrar pagamento
          </Button>
        </div>
      </Modal>

      <Modal aberto={pedindoPin} titulo="Autorizar pagamento" onFechar={() => setPedindoPin(false)}>
        <p className="mb-4">Digite o PIN de quem está autorizando este pagamento:</p>
        <PinInput modo="confirmacao" onPinCompleto={confirmarComPin} onSucesso={() => setPedindoPin(false)} />
      </Modal>
    </>
  );
}