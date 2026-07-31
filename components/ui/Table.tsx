import type { ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import type { LucideIcon } from "lucide-react";

export interface ColunaTabela<T> {
  chave: string;
  cabecalho: string;
  render?: (item: T) => ReactNode;
  className?: string;
}

export interface TableProps<T> {
  colunas: ColunaTabela<T>[];
  dados: T[];
  chaveLinha: (item: T) => string;
  vazioIcone: LucideIcon;
  vazioTitulo: string;
  vazioDescricao?: string;
}

export function Table<T>({ colunas, dados, chaveLinha, vazioIcone, vazioTitulo, vazioDescricao }: TableProps<T>) {
  if (dados.length === 0) {
    return <EmptyState icone={vazioIcone} titulo={vazioTitulo} descricao={vazioDescricao} />;
  }

  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="text-xs text-slate-500 border-b border-slate-100">
          {colunas.map((c) => (
            <th key={c.chave} className="py-2 px-5 font-medium">
              {c.cabecalho}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dados.map((item) => (
          <tr key={chaveLinha(item)} className="border-b border-slate-50 last:border-0">
            {colunas.map((c) => (
              <td key={c.chave} className={`py-3 px-5 text-slate-800 ${c.className ?? ""}`}>
                {c.render ? c.render(item) : String((item as Record<string, unknown>)[c.chave] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}