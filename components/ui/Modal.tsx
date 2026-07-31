"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export interface ModalProps {
  aberto: boolean;
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
}

export function Modal({ aberto, titulo, onFechar, children, rodape }: ModalProps) {
  const referencia = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aberto, onFechar]);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 animate-fade-in" onClick={onFechar} aria-hidden="true" />
      <div
        ref={referencia}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-titulo"
        className="relative w-full max-w-md max-h-[90vh] flex flex-col rounded-xl bg-white shadow-elevated animate-slide-up"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 id="modal-titulo" className="font-semibold text-slate-900">
            {titulo}
          </h2>
          <button onClick={onFechar} aria-label="Fechar" className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 text-sm text-slate-600 overflow-y-auto">{children}</div>
        {rodape && <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200 shrink-0">{rodape}</div>}
      </div>
    </div>
  );
}