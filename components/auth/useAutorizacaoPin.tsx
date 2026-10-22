"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { PinInput } from "@/components/auth/PinInput";

/** Sem nenhuma operação por este tempo, o PIN guardado é esquecido e volta a ser pedido. */
export const VALIDADE_AUTORIZACAO_MS = 10 * 60 * 1000;

interface MemoriaPin {
  pin: string | null;
  expiraEm: number;
}

const MemoriaPinContext = createContext<React.MutableRefObject<MemoriaPin> | null>(null);

/**
 * Mantém o PIN de quem autorizou SÓ na memória desta tela: some ao sair do menu (o provedor é
 * desmontado), ao recarregar a página ou após `VALIDADE_AUTORIZACAO_MS` sem uso. Nada é gravado
 * no navegador nem no servidor. O servidor continua validando o PIN em CADA operação — se o
 * cargo da pessoa mudou ou o PIN foi trocado, a próxima operação é recusada e o PIN é pedido de novo.
 * Telas sem este provedor continuam pedindo o PIN a cada operação.
 */
export function AutorizacaoPinProvider({ children }: { children: ReactNode }) {
  const memoria = useRef<MemoriaPin>({ pin: null, expiraEm: 0 });
  useEffect(() => {
    const atual = memoria.current;
    return () => {
      atual.pin = null;
      atual.expiraEm = 0;
    };
  }, []);
  return <MemoriaPinContext.Provider value={memoria}>{children}</MemoriaPinContext.Provider>;
}

interface Pendente<R> {
  executar: (pin: string) => Promise<R>;
  resolver: (resultado: R | null) => void;
  resultado?: R;
}

/**
 * Pede o PIN de um autorizador e executa a Server Action com ele. Se o servidor recusar (PIN errado,
 * bloqueio ou cargo sem permissão — `erroAutorizacao`), o pedido continua aberto mostrando o motivo.
 * Dentro de um `AutorizacaoPinProvider`, o PIN aceito é reaproveitado nas operações seguintes da mesma
 * tela. Resolve com o resultado da action, ou `null` se a pessoa cancelar. Quem decide é sempre o servidor.
 */
export function useAutorizacaoPin(titulo = "Autorização necessária") {
  const [aberto, setAberto] = useState(false);
  const pendente = useRef<Pendente<never> | null>(null);
  const memoria = useContext(MemoriaPinContext);

  const pedirPin = useCallback(
    <R extends { erroAutorizacao?: string }>(executar: (pin: string) => Promise<R>) =>
      new Promise<R | null>((resolver) => {
        pendente.current = { executar, resolver } as unknown as Pendente<never>;
        setAberto(true);
      }),
    []
  );

  const autorizar = useCallback(
    async <R extends { erroAutorizacao?: string }>(executar: (pin: string) => Promise<R>): Promise<R | null> => {
      const guardado = memoria?.current;
      if (guardado?.pin && Date.now() < guardado.expiraEm) {
        const resultado = await executar(guardado.pin);
        if (!resultado.erroAutorizacao) {
          guardado.expiraEm = Date.now() + VALIDADE_AUTORIZACAO_MS;
          return resultado;
        }
        // O servidor não aceitou mais (PIN trocado, cargo alterado, bloqueio): esquece e pede de novo.
        guardado.pin = null;
        guardado.expiraEm = 0;
      }
      return pedirPin(executar);
    },
    [memoria, pedirPin]
  );

  async function aoCompletarPin(pin: string) {
    const p = pendente.current as Pendente<{ erroAutorizacao?: string }> | null;
    if (!p) return;
    const resultado = await p.executar(pin);
    if (resultado.erroAutorizacao) throw new Error(resultado.erroAutorizacao);
    p.resultado = resultado;
    if (memoria) memoria.current = { pin, expiraEm: Date.now() + VALIDADE_AUTORIZACAO_MS };
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
