"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { PinInput } from "@/components/auth/PinInput";

interface Pendente<R> {
  executar: (pin: string) => Promise<R>;
  resolver: (resultado: R | null) => void;
  resultado?: R;
}

/**
 * Pede o PIN de um autorizador e executa a Server Action com ele. Se o servidor recusar (PIN errado,
 * bloqueio ou cargo sem permissão — `erroAutorizacao`), o pedido continua aberto mostrando o motivo.
 * Resolve com o resultado da action, ou `null` se a pessoa cancelar. Quem decide é sempre o servidor.
 */
export function useAutorizacaoPin(titulo = "Autorização necessária") {
  const [aberto, setAberto] = useState(false);
  const pendente = useRef<Pendente<never> | null>(null);

  const autorizar = useCallback(
    <R extends { erroAutorizacao?: string }>(executar: (pin: string) => Promise<R>) =>
      new Promise<R | null>((resolver) => {
        pendente.current = { executar, resolver } as unknown as Pendente<never>;
        setAberto(true);
      }),
    []
  );

  async function aoCompletarPin(pin: string) {
    const p = pendente.current as Pendente<{ erroAutorizacao?: string }> | null;
    if (!p) return;
    const resultado = await p.executar(pin);
    if (resultado.erroAutorizacao) throw new Error(resultado.erroAutorizacao);
    p.resultado = resultado;
  }

  function concluir() {
    const p = pendente.current as Pendente<unknown> | null;
    pendente.current = null;
    setAberto(false);
    p?.resolver(p.resultado ?? null);
  }

  const modalPin: ReactNode = (
    <Modal aberto={aberto} titulo={titulo} onFechar={concluir}>
      <p className="mb-4">Digite o PIN do proprietário ou do gerente para autorizar:</p>
      <PinInput modo="confirmacao" onPinCompleto={aoCompletarPin} onSucesso={concluir} />
    </Modal>
  );

  return { autorizar, modalPin };
}
