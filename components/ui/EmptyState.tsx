import { type LucideIcon } from "lucide-react";
import { Button } from "./Button";
import { COR_FUNDO_MODULO, COR_ICONE_MODULO, type ModuloCor } from "./cores-modulo";

export interface EmptyStateProps {
  icone: LucideIcon;
  /** Módulo dono da tela: o ícone central ganha a cor do módulo. */
  modulo?: ModuloCor;
  titulo: string;
  descricao?: string;
  acaoTexto?: string;
  onAcao?: () => void;
}

/**
 * Antes, uma tabela vazia (nenhum produto cadastrado, nenhuma venda no
 * período) só mostrava... nada. Substitui esse vazio por um convite
 * claro à ação, consistente em qualquer tela do app.
 */
export function EmptyState({ icone: Icone, modulo, titulo, descricao, acaoTexto, onAcao }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-4">
      <div className={`w-12 h-12 rounded-full ${modulo ? COR_FUNDO_MODULO[modulo] : "bg-slate-100"} flex items-center justify-center mb-3`}>
        <Icone className={`w-6 h-6 ${modulo ? COR_ICONE_MODULO[modulo] : "text-slate-400"}`} />
      </div>
      <p className="font-medium text-slate-700">{titulo}</p>
      {descricao && <p className="text-sm text-slate-500 mt-1 max-w-xs">{descricao}</p>}
      {acaoTexto && onAcao && (
        <Button variante="secondary" tamanho="sm" onClick={onAcao} className="mt-4">
          {acaoTexto}
        </Button>
      )}
    </div>
  );
}