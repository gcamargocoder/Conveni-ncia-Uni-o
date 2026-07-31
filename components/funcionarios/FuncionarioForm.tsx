"use client";

import { useState } from "react";
import { Cargo } from "@/types/funcionario";
import { criarFuncionarioAction } from "@/lib/auth/funcionarios-actions";
import { PinInput } from "@/components/auth/PinInput";

const CARGOS: { valor: Cargo; rotulo: string }[] = [
  { valor: "caixa", rotulo: "Caixa" },
  { valor: "estoquista", rotulo: "Estoquista" },
  { valor: "gerente", rotulo: "Gerente" },
  { valor: "proprietario", rotulo: "Proprietário" },
];

export function FuncionarioForm() {
  const [nome, setNome] = useState("");
  const [cargo, setCargo] = useState<Cargo>("caixa");
  const [pin, setPin] = useState("");
  const [pedindoAutorizacao, setPedindoAutorizacao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  async function autorizarComPin(pinAutorizador: string) {
    const resultado = await criarFuncionarioAction({ nome, cargo, pin }, pinAutorizador);
    if (!resultado.sucesso) throw new Error(resultado.erro ?? "Erro ao cadastrar.");
    setNome("");
    setPin("");
    setSucesso(true);
  }

  return (
    <div className="flex flex-col gap-3 max-w-md">
      <input
        placeholder="Nome do funcionário"
        className="h-12 px-3 border rounded-lg text-lg"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
      />
      <select
        className="h-12 px-3 border rounded-lg text-lg"
        value={cargo}
        onChange={(e) => setCargo(e.target.value as Cargo)}
      >
        {CARGOS.map((c) => (
          <option key={c.valor} value={c.valor}>
            {c.rotulo}
          </option>
        ))}
      </select>
      <input
        placeholder="PIN de 4 dígitos para o novo funcionário"
        maxLength={4}
        className="h-12 px-3 border rounded-lg text-lg"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
      />

      {!pedindoAutorizacao ? (
        <button
          onClick={() => setPedindoAutorizacao(true)}
          disabled={nome.trim().length < 2 || pin.length !== 4}
          className="h-12 rounded-xl bg-slate-900 text-white font-semibold disabled:opacity-40"
        >
          Continuar
        </button>
      ) : (
        <div className="border rounded-xl p-4">
          <p className="text-sm text-slate-600 mb-3">
            Cadastrar funcionário exige autorização — digite o PIN do gerente/proprietário:
          </p>
          <PinInput
            modo="confirmacao"
            onPinCompleto={autorizarComPin}
            onSucesso={() => setPedindoAutorizacao(false)}
          />
        </div>
      )}

      {erro && <p className="text-red-600 text-sm">{erro}</p>}
      {sucesso && <p className="text-green-600 text-sm">Funcionário cadastrado!</p>}
    </div>
  );
}
