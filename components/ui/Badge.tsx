import { HTMLAttributes } from "react";

type Variante = "success" | "danger" | "warning" | "neutral" | "brand";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variante?: Variante;
}

const CLASSES_VARIANTE: Record<Variante, string> = {
  success: "bg-success-50 text-success-700",
  danger: "bg-danger-50 text-danger-700",
  warning: "bg-warning-50 text-warning-700",
  neutral: "bg-slate-100 text-slate-600",
  brand: "bg-brand-50 text-brand-700",
};

/**
 * Substitui texto colorido solto (ex: "(cancelada)" em vermelho puro,
 * "estoque baixo" sem nenhum destaque visual) por uma etiqueta
 * consistente em todo o app — mesmo raio, mesmo peso de fonte, mesma
 * lógica de cor semântica em qualquer tela que precisar.
 */
export function Badge({ variante = "neutral", className = "", children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${CLASSES_VARIANTE[variante]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}