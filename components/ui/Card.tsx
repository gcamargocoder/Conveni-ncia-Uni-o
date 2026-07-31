import { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  semPadding?: boolean;
}

/**
 * Container padrão — mesma borda, raio e sombra sutil em toda tela que
 * precisar de um "cartão" (formulário, item de lista, resumo do PDV).
 * `semPadding` para quando o conteúdo interno (ex: uma tabela) já
 * controla seu próprio espaçamento.
 */
export function Card({ semPadding, className = "", children, ...props }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-card ${semPadding ? "" : "p-5"} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}