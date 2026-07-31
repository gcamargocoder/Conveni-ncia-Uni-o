"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export interface OperadorTurno {
  id: string;
  nome: string;
  cargo: string;
}

interface OperadorContextValue {
  operador: OperadorTurno | null;
  definirOperador: (op: OperadorTurno) => void;
  encerrarTurno: () => void;
}

const OperadorContext = createContext<OperadorContextValue | undefined>(undefined);

/**
 * Guarda quem está operando o caixa/turno. De propósito, isso vive
 * só em memória (state do React) — não é um "login" persistente.
 * Fechou a aba, precisa identificar de novo. Operações sensíveis
 * (cancelar venda, ajuste de estoque) SEMPRE pedem o PIN de novo,
 * independente de já haver operador de turno definido.
 */
export function OperadorProvider({ children }: { children: ReactNode }) {
  const [operador, setOperador] = useState<OperadorTurno | null>(null);

  return (
    <OperadorContext.Provider
      value={{
        operador,
        definirOperador: setOperador,
        encerrarTurno: () => setOperador(null),
      }}
    >
      {children}
    </OperadorContext.Provider>
  );
}

export function useOperadorTurno() {
  const ctx = useContext(OperadorContext);
  if (!ctx) throw new Error("useOperadorTurno deve ser usado dentro de OperadorProvider");
  return ctx;
}
