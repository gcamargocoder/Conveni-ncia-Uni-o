"use client";

interface NumericKeypadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}

/**
 * Teclado grande, poucos cliques, alto contraste — conforme o
 * princípio de interface do projeto: usuário novo aprende em minutos.
 */
export function NumericKeypad({ onDigit, onBackspace, onClear }: NumericKeypadProps) {
  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
      {digits.map((d) => (
        <button
          key={d}
          onClick={() => onDigit(d)}
          className="h-16 text-2xl font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 transition-colors"
        >
          {d}
        </button>
      ))}
      <button
        onClick={onClear}
        className="h-16 text-lg font-semibold rounded-xl bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
      >
        Limpar
      </button>
      <button
        onClick={() => onDigit("0")}
        className="h-16 text-2xl font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 transition-colors"
      >
        0
      </button>
      <button
        onClick={onBackspace}
        className="h-16 text-lg font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors"
      >
        ⌫
      </button>
    </div>
  );
}
