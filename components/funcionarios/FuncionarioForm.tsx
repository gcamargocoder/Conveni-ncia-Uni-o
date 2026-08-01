"use client";

import { useState } from "react";
import { Cargo } from "@/types/funcionario";
import { criarFuncionarioAction } from "@/lib/auth/funcionarios-actions";
import { PinInput } from "@/components/auth/PinInput";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/ToastProvider";

const CARGOS: { valor: Cargo; rotulo: string }[] = [
  { valor: "caixa", rotulo: "Caixa" },
  { valor: "frentista", rotulo: "Frentista" },
  { valor: "estoquista", rotulo: "Estoquista" },
  { valor: "gerente", rotulo: "Gerente" },
  { valor: "proprietario", rotulo: "Proprietário" },
];

export interface FuncionarioFormProps {
  onSucesso?: () => void;
}

export function FuncionarioForm({ onSucesso }: FuncionarioFormProps) {
  const [nome, setNome] = useState("");
  const [cargo, setCargo] = useState<Cargo>("caixa");
  const [pin, setPin] = useState("");
  const [pedindoAutorizacao, setPedindoAutorizacao] = useState(false);
  const { mostrar } = useToast();

  async function autorizarComPin(pinAutorizador: string) {
    const resultado = await criarFuncionarioAction({ nome, cargo, pin }, pinAutorizador);
    if (!resultado.sucesso) throw new Error(resultado.erro ?? "Erro ao cadastrar.");
    setNome("");
    setPin("");
    mostrar("success", "Funcionário cadastrado.");
    onSucesso?.();
  }

  return (
    <div className="flex flex-col gap-4 max-w-md">
      <Input rotulo="Nome do funcionário" value={nome} onChange={(e) => setNome(e.target.value)} />

      <Select rotulo="Cargo" value={cargo} onChange={(e) => setCargo(e.target.value as Cargo)}>
        {CARGOS.map((c) => (
          <option key={c.valor} value={c.valor}>
            {c.rotulo}
          </option>
        ))}
      </Select>

      <Input
        rotulo="PIN de 4 dígitos para o novo funcionário"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
      />

      <Button onClick={() => setPedindoAutorizacao(true)} disabled={nome.trim().length < 2 || pin.length !== 4}>
        Continuar
      </Button>

      <Modal
        aberto={pedindoAutorizacao}
        titulo="Autorização necessária"
        onFechar={() => setPedindoAutorizacao(false)}
      >
        <p className="mb-4">
          Cadastrar funcionário exige autorização — digite o PIN do gerente ou proprietário:
        </p>
        <PinInput
          modo="confirmacao"
          onPinCompleto={autorizarComPin}
          onSucesso={() => setPedindoAutorizacao(false)}
        />
      </Modal>
    </div>
  );
}