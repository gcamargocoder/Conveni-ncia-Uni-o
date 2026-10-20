"use client";

import { InputHTMLAttributes, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export interface CampoSenhaProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  rotulo: string;
  erro?: string;
  dica?: string;
}

/** Campo de senha com botão de mostrar/ocultar, no mesmo visual do Input do sistema. */
export function CampoSenha({ rotulo, erro, dica, className = "", id, ...props }: CampoSenhaProps) {
  const idGerado = useId();
  const inputId = id ?? idGerado;
  const [visivel, setVisivel] = useState(false);

  return (
    <div className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
        {rotulo}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type={visivel ? "text" : "password"}
          className={`w-full h-11 pl-3 pr-11 rounded-lg text-base bg-white border ${
            erro ? "border-danger-600" : "border-slate-300"
          } placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-400`}
          aria-invalid={!!erro}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={visivel}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-50"
        >
          {visivel ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {dica && !erro && <p className="text-slate-500 text-xs">{dica}</p>}
      {erro && <p className="text-danger-600 text-sm">{erro}</p>}
    </div>
  );
}
