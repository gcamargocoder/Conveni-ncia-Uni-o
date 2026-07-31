import { InputHTMLAttributes, forwardRef, useId } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  rotulo?: string;
  erro?: string;
}

/**
 * Antes, cada formulário (produto, funcionário, fornecedor...) escrevia
 * `className="w-full h-12 px-3 border rounded-lg text-lg"` manualmente
 * — funcionava, mas qualquer ajuste futuro exigiria editar N arquivos.
 * Agora é um componente só. Erro muda a borda para vermelho e mostra a
 * mensagem embaixo, sempre no mesmo lugar.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ rotulo, erro, className = "", id, ...props }, ref) => {
    const idGerado = useId();
    const inputId = id ?? idGerado;

    return (
      <div className="flex flex-col gap-1.5">
        {rotulo && (
          <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
            {rotulo}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            h-11 px-3 rounded-lg text-base bg-white
            border ${erro ? "border-danger-600" : "border-slate-300"}
            placeholder:text-slate-400
            disabled:bg-slate-50 disabled:text-slate-400
            ${className}
          `}
          aria-invalid={!!erro}
          {...props}
        />
        {erro && <p className="text-danger-600 text-sm">{erro}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";