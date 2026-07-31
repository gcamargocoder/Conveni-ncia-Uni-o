import { HTMLAttributes } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, type LucideIcon } from "lucide-react";

type Variante = "success" | "danger" | "warning" | "info";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variante?: Variante;
  titulo?: string;
}

const ICONE: Record<Variante, LucideIcon> = {
  success: CheckCircle2,
  danger: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const CLASSES_VARIANTE: Record<Variante, string> = {
  success: "bg-success-50 text-success-700 border-success-600/20",
  danger: "bg-danger-50 text-danger-700 border-danger-600/20",
  warning: "bg-warning-50 text-warning-700 border-warning-600/20",
  info: "bg-brand-50 text-brand-700 border-brand-600/20",
};

/**
 * Diferente do Toast (aparece e some sozinho, no canto da tela): Alert
 * fica fixo no fluxo da página, para avisos que precisam continuar
 * visíveis enquanto o usuário decide algo — ex: "produto abaixo do
 * mínimo" no dashboard, "preço abaixo do custo" num formulário.
 */
export function Alert({ variante = "info", titulo, className = "", children, ...props }: AlertProps) {
  const Icone = ICONE[variante];
  return (
    <div role="alert" className={`flex gap-3 rounded-lg border p-4 ${CLASSES_VARIANTE[variante]} ${className}`} {...props}>
      <Icone className="w-5 h-5 shrink-0 mt-0.5" />
      <div>
        {titulo && <p className="font-semibold text-sm">{titulo}</p>}
        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
}