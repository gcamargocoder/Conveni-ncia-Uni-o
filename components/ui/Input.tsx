import { InputHTMLAttributes, forwardRef, useId, FocusEvent } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  rotulo?: string;
  erro?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ rotulo, erro, className = "", id, type, onFocus, ...props }, ref) => {
    const idGerado = useId();
    const inputId = id ?? idGerado;

    function aoFocar(evento: FocusEvent<HTMLInputElement>) {
      if (type === "number") {
        evento.target.select();
      }
      onFocus?.(evento);
    }

    return (
      <div className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
        {rotulo && (
          <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
            {rotulo}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          onFocus={aoFocar}
          className={`
            w-full h-11 px-3 rounded-lg text-base bg-white
            border ${erro ? "border-danger-600" : "border-slate-300"}
            placeholder:text-slate-400
            disabled:bg-slate-50 disabled:text-slate-400
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