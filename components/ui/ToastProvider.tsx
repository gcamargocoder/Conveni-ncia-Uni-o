"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X, type LucideIcon } from "lucide-react";

type TipoToast = "success" | "danger" | "warning" | "info";

interface ToastItem {
  id: string;
  tipo: TipoToast;
  mensagem: string;
}

interface ToastContextValue {
  mostrar: (tipo: TipoToast, mensagem: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const ICONE: Record<TipoToast, LucideIcon> = {
  success: CheckCircle2,
  danger: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const CLASSES_TIPO: Record<TipoToast, string> = {
  success: "bg-success-50 text-success-700 border-success-600/20",
  danger: "bg-danger-50 text-danger-700 border-danger-600/20",
  warning: "bg-warning-50 text-warning-700 border-warning-600/20",
  info: "bg-brand-50 text-brand-700 border-brand-600/20",
};

const DURACAO_MS = 4000;

/**
 * Substitui alert()/texto solto de sucesso-erro em cada tela (Etapa 7).
 * Envolve o app inteiro uma vez (ver app/layout.tsx) — qualquer
 * Client Component chama useToast().mostrar(...) sem precisar
 * gerenciar seu próprio estado de mensagem.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const contador = useRef(0);

  const remover = useCallback((id: string) => {
    setToasts((atual) => atual.filter((t) => t.id !== id));
  }, []);

  const mostrar = useCallback(
    (tipo: TipoToast, mensagem: string) => {
      const id = `toast-${++contador.current}`;
      setToasts((atual) => [...atual, { id, tipo, mensagem }]);
      setTimeout(() => remover(id), DURACAO_MS);
    },
    [remover]
  );

  return (
    <ToastContext.Provider value={{ mostrar }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-full max-w-sm px-4 sm:px-0">
        {toasts.map((t) => {
          const Icone = ICONE[t.tipo];
          return (
            <div
              key={t.id}
              role="status"
              className={`flex items-start gap-3 rounded-lg border px-4 py-3 shadow-elevated animate-slide-up ${CLASSES_TIPO[t.tipo]}`}
            >
              <Icone className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm font-medium flex-1">{t.mensagem}</p>
              <button onClick={() => remover(t.id)} aria-label="Fechar aviso" className="opacity-60 hover:opacity-100">
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return ctx;
}