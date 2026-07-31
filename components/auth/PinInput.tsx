"use client";

import { useState } from "react";
import { NumericKeypad } from "@/components/ui/NumericKeypad";
import { validarPinAction } from "@/lib/auth/actions";
import { useOperadorTurno } from "@/hooks/useOperadorTurno";

const PIN_LENGTH = 4;

interface PinInputProps {
  onSucesso?: () => void;
  /**
   * modo "turno" (padrão): valida o PIN aqui mesmo e define o operador
   * do turno global — usado na tela de identificação inicial.
   *
   * modo "confirmacao": NÃO valida nem seta operador global. Apenas
   * devolve o PIN digitado via onPinCompleto para que quem chamou
   * (ex: uma Server Action de estoque/venda) faça sua própria validação
   * e checagem de permissão. Evita que confirmar uma operação sensível
   * troque silenciosamente quem está "no turno".
   */
  modo?: "turno" | "confirmacao";
  onPinCompleto?: (pin: string) => void | Promise<void>;
}

export function PinInput({ onSucesso, modo = "turno", onPinCompleto }: PinInputProps) {
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);
  const { definirOperador } = useOperadorTurno();

  async function confirmar(pinCompleto: string) {
    if (modo === "confirmacao") {
      setVerificando(true);
      setErro(null);
      try {
        await onPinCompleto?.(pinCompleto);
        onSucesso?.();
      } catch (e) {
        setErro((e as Error).message ?? "Erro ao confirmar.");
      } finally {
        setVerificando(false);
        setPin("");
      }
      return;
    }

    setVerificando(true);
    setErro(null);

    const resultado = await validarPinAction(pinCompleto);

    if (!resultado.sucesso || !resultado.funcionario) {
      setErro(resultado.erro ?? "PIN incorreto.");
      setPin("");
      setVerificando(false);
      return;
    }

    definirOperador(resultado.funcionario);
    setVerificando(false);
    onSucesso?.();
  }

  function adicionarDigito(digito: string) {
    if (verificando) return;
    const novoPin = (pin + digito).slice(0, PIN_LENGTH);
    setPin(novoPin);
    if (novoPin.length === PIN_LENGTH) confirmar(novoPin);
  }

  return (
    <div className="flex flex-col items-center gap-6">
      {/* bolinhas grandes mostram progresso sem exibir o PIN na tela */}
      <div className="flex gap-3">
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <div
            key={i}
            className={`w-5 h-5 rounded-full border-2 ${
              i < pin.length ? "bg-slate-800 border-slate-800" : "border-slate-300"
            }`}
          />
        ))}
      </div>

      {erro && <p className="text-red-600 text-sm font-medium">{erro}</p>}
      {verificando && <p className="text-slate-500 text-sm">Verificando...</p>}

      <NumericKeypad
        onDigit={adicionarDigito}
        onBackspace={() => setPin((p) => p.slice(0, -1))}
        onClear={() => setPin("")}
      />
    </div>
  );
}
