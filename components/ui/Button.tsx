import { ButtonHTMLAttributes, forwardRef } from "react";
import { Loader2 } from "lucide-react";

type Variante = "primary" | "secondary" | "danger" | "ghost";
type Tamanho = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
  carregando?: boolean;
  larguraTotal?: boolean;
}

const CLASSES_VARIANTE: Record<Variante, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-900 disabled:bg-brand-200",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-300",
  danger: "bg-danger-600 text-white hover:bg-danger-700 disabled:bg-danger-50 disabled:text-danger-600/40",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 disabled:text-slate-300",
};

const CLASSES_TAMANHO: Record<Tamanho, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-base gap-2",
  lg: "h-14 px-6 text-lg gap-2",
};

/**
 * Botão único para todo o app — antes cada tela escrevia suas próprias
 * classes Tailwind para botão, gerando pequenas inconsistências (Etapa
 * 7, auditoria de UI). `carregando` mostra um spinner e desabilita o
 * clique automaticamente, sem precisar controlar isso manualmente em
 * cada tela.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variante = "primary", tamanho = "md", carregando, larguraTotal, disabled, className = "", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || carregando}
        className={`
          inline-flex items-center justify-center rounded-lg font-semibold
          transition-colors duration-150
          disabled:cursor-not-allowed
          ${CLASSES_VARIANTE[variante]}
          ${CLASSES_TAMANHO[tamanho]}
          ${larguraTotal ? "w-full" : ""}
          ${className}
        `}
        {...props}
      >
        {carregando && <Loader2 className="w-4 h-4 animate-spin" />}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";