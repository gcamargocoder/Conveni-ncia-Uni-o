import { InputHTMLAttributes, forwardRef, useId, useState, useEffect, useRef, FocusEvent, ChangeEvent } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  rotulo?: string;
  erro?: string;
}

function normalizarDecimal(bruto: string): string {
  const comPontoNoLugarDaVirgula = bruto.replace(",", ".");
  const apenasDigitosEPonto = comPontoNoLugarDaVirgula.replace(/[^0-9.]/g, "");
  const partes = apenasDigitosEPonto.split(".");
  return partes.length > 2 ? `${partes[0]}.${partes.slice(1).join("")}` : apenasDigitosEPonto;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ rotulo, erro, className = "", id, type, value, onFocus, onBlur, onChange, ...props }, ref) => {
    const idGerado = useId();
    const inputId = id ?? idGerado;
    const ehNumerico = type === "number";
    const focado = useRef(false);

    const [buffer, setBuffer] = useState(() => (value != null ? String(value) : ""));

    useEffect(() => {
      if (!ehNumerico) return;
      if (!focado.current) {
        setBuffer(value != null ? String(value) : "");
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, ehNumerico]);

    function aoFocar(evento: FocusEvent<HTMLInputElement>) {
      focado.current = true;
      if (ehNumerico) {
        const alvo = evento.target;
        requestAnimationFrame(() => alvo.select());
      }
      onFocus?.(evento);
    }

    function aoDesfocar(evento: FocusEvent<HTMLInputElement>) {
      focado.current = false;
      if (ehNumerico) {
        setBuffer(value != null ? String(value) : "");
      }
      onBlur?.(evento);
    }

    function aoMudar(evento: ChangeEvent<HTMLInputElement>) {
      if (!ehNumerico) {
        onChange?.(evento);
        return;
      }

      const normalizado = normalizarDecimal(evento.target.value);
      setBuffer(normalizado);
      evento.target.value = normalizado;
      onChange?.(evento);
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
          type={ehNumerico ? "text" : type}
          inputMode={ehNumerico ? "decimal" : undefined}
          value={ehNumerico ? buffer : value}
          onFocus={aoFocar}
          onBlur={aoDesfocar}
          onChange={aoMudar}
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