"use client";

import { Search } from "lucide-react";

interface CampoBuscaProps {
  valor: string;
  onChange: (valor: string) => void;
  placeholder: string;
  /** Classe de cor do ícone (cada módulo tem a sua). */
  corIcone?: string;
  rotulo?: string;
}

/** Caixa de pesquisa padrão das listas: filtra enquanto digita, sem botão de confirmação. */
export function CampoBusca({ valor, onChange, placeholder, corIcone = "text-emerald-500", rotulo }: CampoBuscaProps) {
  return (
    <div className="relative flex-1">
      <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${corIcone}`} aria-hidden="true" />
      <input
        type="search"
        aria-label={rotulo ?? placeholder}
        placeholder={placeholder}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className="w-full h-11 pl-10 pr-3 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600"
      />
    </div>
  );
}
