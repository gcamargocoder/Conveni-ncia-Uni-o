import { ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type Tipo = "editar" | "editarVerde" | "excluir";

export interface BotaoAcaoTabelaProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tipo?: Tipo;
  icone: LucideIcon;
  children: ReactNode;
}

const CLASSES_TIPO: Record<Tipo, { botao: string; icone: string }> = {
  editar: {
    botao: "bg-orange-50 text-orange-700 ring-orange-100 hover:bg-orange-100 hover:ring-orange-200",
    icone: "text-orange-500",
  },
  editarVerde: {
    botao: "bg-emerald-50 text-emerald-700 ring-emerald-100 hover:bg-emerald-100 hover:ring-emerald-200",
    icone: "text-emerald-500",
  },
  excluir: {
    botao: "bg-rose-50 text-rose-700 ring-rose-100 hover:bg-rose-100 hover:ring-rose-200",
    icone: "text-rose-500",
  },
};

/**
 * Ação de linha de tabela (Editar/Excluir) em pílula sutil. Centraliza o
 * visual que antes era repetido, com variações, em cada modal de edição.
 */
export const BotaoAcaoTabela = forwardRef<HTMLButtonElement, BotaoAcaoTabelaProps>(
  ({ tipo = "editar", icone: Icone, className = "", children, ...props }, ref) => {
    const classes = CLASSES_TIPO[tipo];
    return (
      <button
        ref={ref}
        type="button"
        className={`group inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ring-1 transition-all duration-300 ${classes.botao} ${className}`}
        {...props}
      >
        <Icone className={`w-3.5 h-3.5 transition-transform duration-300 group-hover:scale-110 ${classes.icone}`} />
        {children}
      </button>
    );
  }
);

BotaoAcaoTabela.displayName = "BotaoAcaoTabela";
