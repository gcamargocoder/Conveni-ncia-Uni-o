import { SelectHTMLAttributes, forwardRef, useId } from "react";
import { ChevronDown } from "lucide-react";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  rotulo?: string;
  erro?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ rotulo, erro, className = "", id, children, ...props }, ref) => {
    const idGerado = useId();
    const selectId = id ?? idGerado;

    return (
      <div className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
        {rotulo && (
          <label htmlFor={selectId} className="text-sm font-medium text-slate-700">
            {rotulo}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={`
              h-11 w-full pl-3 pr-9 rounded-lg text-base bg-white appearance-none
              border ${erro ? "border-danger-600" : "border-slate-300"}
              disabled:bg-slate-50 disabled:text-slate-400
            `}
            aria-invalid={!!erro}
            {...props}
          >
            {children}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        {erro && <p className="text-danger-600 text-sm">{erro}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";