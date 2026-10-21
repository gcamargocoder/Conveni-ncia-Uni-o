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
  /** Tema escuro (telas Swiss Dark). Padrão: claro, como antes. */
  escuro?: boolean;
}

export function Table<T>({ colunas, dados, chaveLinha, vazioIcone, vazioTitulo, vazioDescricao, escuro }: TableProps<T>) {
  if (dados.length === 0) {
    return <EmptyState icone={vazioIcone} titulo={vazioTitulo} descricao={vazioDescricao} escuro={escuro} />;
  }

  const divisorMovel = escuro ? "divide-surface-border" : "divide-slate-100";
  const rotuloMovel = escuro ? "text-zinc-400" : "text-slate-500";
  const valorMovel = escuro ? "text-white" : "text-slate-800";
  const cabecalhoLinha = escuro
    ? "text-xs font-medium text-zinc-400 uppercase tracking-wider bg-surface-elevated border-b border-surface-border"
    : "text-xs text-slate-500 border-b border-slate-100";
  const linha = escuro
    ? "border-b border-surface-border last:border-0 odd:bg-surface even:bg-white/[0.02] hover:bg-zinc-800/30 transition-colors duration-150"
    : "border-b border-slate-50 last:border-0";
  const celula = escuro ? "text-white" : "text-slate-800";

  return (
    <>
      <div className={`sm:hidden flex flex-col divide-y ${divisorMovel}`}>
        {dados.map((item) => (
          <div key={chaveLinha(item)} className="py-3 px-5 flex flex-col gap-1.5">
            {colunas.map((c) => {
              const valor = c.render ? c.render(item) : String((item as Record<string, unknown>)[c.chave] ?? "");
              if (!c.cabecalho) {
                return (
                  <div key={c.chave} className="pt-1">
                    {valor}
                  </div>
                );
              }
              return (
                <div key={c.chave} className="flex items-center justify-between gap-3 text-sm">
                  <span className={`${rotuloMovel} shrink-0`}>{c.cabecalho}</span>
                  <span className={`${valorMovel} text-right ${c.className ?? ""}`}>{valor}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="hidden sm:block">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className={cabecalhoLinha}>
              {colunas.map((c) => (
                <th key={c.chave} className="py-2 px-3 font-medium">
                  {c.cabecalho}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dados.map((item) => (
              <tr key={chaveLinha(item)} className={linha}>
                {colunas.map((c) => (
                  <td key={c.chave} className={`py-3 px-3 ${celula} break-words ${c.className ?? ""}`}>
                    {c.render ? c.render(item) : String((item as Record<string, unknown>)[c.chave] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
