import { HTMLAttributes } from "react";

const CLASSES_INTERATIVO =
  "transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:ring-2 hover:ring-brand-200";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  semPadding?: boolean;
  /** Cartão clicável/destacado: ganha elevação, sombra e brilho de borda no hover. */
  interativo?: boolean;
}

/**
 * Container padrão — mesma borda, raio e sombra sutil em toda tela que
 * precisar de um "cartão" (formulário, item de lista, resumo do PDV).
 * `semPadding` para quando o conteúdo interno (ex: uma tabela) já
 * controla seu próprio espaçamento.
 */
export function Card({ semPadding, interativo, className = "", children, ...props }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white shadow-card ${semPadding ? "" : "p-5"} ${interativo ? CLASSES_INTERATIVO : ""} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}