import { type LucideIcon } from "lucide-react";
import { Button } from "./Button";

export interface EmptyStateProps {
  icone: LucideIcon;
  titulo: string;
  descricao?: string;
  acaoTexto?: string;
  onAcao?: () => void;
  /** Tema escuro (telas Swiss Dark). Padrão: claro, como antes. */
  escuro?: boolean;
}

/**
 * Antes, uma tabela vazia (nenhum produto cadastrado, nenhuma venda no
 * período) só mostrava... nada. Substitui esse vazio por um convite
 * claro à ação, consistente em qualquer tela do app.
 */
export function EmptyState({ icone: Icone, titulo, descricao, acaoTexto, onAcao, escuro }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-4">
      <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 ${escuro ? "bg-zinc-800" : "bg-slate-100"}`}>
        <Icone className={`w-6 h-6 ${escuro ? "text-brand-blue" : "text-slate-400"}`} />
      </div>
      <p className={`font-medium ${escuro ? "text-zinc-200" : "text-slate-700"}`}>{titulo}</p>
      {descricao && <p className={`text-sm mt-1 max-w-xs ${escuro ? "text-zinc-500" : "text-slate-500"}`}>{descricao}</p>}
      {acaoTexto && onAcao && (
        <Button
          variante="secondary"
          tamanho="sm"
          onClick={onAcao}
          className={`mt-4 ${escuro ? "!bg-zinc-800/50 !text-zinc-300 !border-surface-border hover:!text-white" : ""}`}
        >
          {acaoTexto}
        </Button>
      )}
    </div>
  );
}