"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export interface ModalProps {
  aberto: boolean;
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
  /**
   * Enquanto verdadeiro, Esc, o fundo e o botão "Fechar" NÃO fecham o modal. Usado quando há uma operação em
   * andamento (ex.: PIN sendo validado no servidor): fechar agora esconderia o resultado — sucesso ou erro.
   */
  bloqueado?: boolean;
}

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ aberto, titulo, onFechar, children, rodape, bloqueado = false }: ModalProps) {
  const referencia = useRef<HTMLDivElement>(null);
  // Sempre a versão mais recente, sem reinstalar o ouvinte (e sem mexer no foco) a cada render.
  const estado = useRef({ onFechar, bloqueado });
  estado.current = { onFechar, bloqueado };

  function fechar() {
    if (!estado.current.bloqueado) estado.current.onFechar();
  }

  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialogo = referencia.current;
    // Foco: se nada dentro do diálogo o recebeu (ex.: autoFocus), vai para o próprio diálogo.
    if (dialogo && !dialogo.contains(document.activeElement)) dialogo.focus();

    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        fechar();
        return;
      }
      if (e.key !== "Tab" || !dialogo) return;
      // Mantém o Tab dentro do diálogo (modal de verdade: o resto da página fica inacessível).
      const itens = Array.from(dialogo.querySelectorAll<HTMLElement>(FOCAVEIS));
      if (itens.length === 0) {
        e.preventDefault();
        dialogo.focus();
        return;
      }
      const primeiro = itens[0];
      const ultimo = itens[itens.length - 1];
      const ativo = document.activeElement;
      if (e.shiftKey && (ativo === primeiro || ativo === dialogo)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && ativo === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      // Devolve o foco a quem abriu o modal.
      if (anterior && document.contains(anterior)) anterior.focus();
    };
  }, [aberto]);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 animate-fade-in" onClick={fechar} aria-hidden="true" />
      <div
        ref={referencia}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-titulo"
        tabIndex={-1}
        className="relative w-full max-w-md max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-elevated animate-slide-up outline-none"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 id="modal-titulo" className="font-semibold text-slate-900">
            {titulo}
          </h2>
          <button
            onClick={fechar}
            aria-label="Fechar"
            aria-disabled={bloqueado || undefined}
            className={`text-slate-400 hover:text-slate-600 ${bloqueado ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 text-sm text-slate-600 overflow-y-auto">{children}</div>
        {rodape && <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200 shrink-0">{rodape}</div>}
      </div>
    </div>
  );
}
