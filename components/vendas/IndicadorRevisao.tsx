"use client";

import { useCallback, useEffect, useState } from "react";
import { contarVendasRevisaoAction } from "@/lib/vendas/revisao-actions";
import { EVENTO_ATUALIZAR_REVISAO } from "@/lib/vendas/eventos";

export { EVENTO_ATUALIZAR_REVISAO };
const INTERVALO_MS = 60_000;

/**
 * Contagem de vendas aguardando revisão, para o item do menu. Só é montado para
 * administradores (o item do menu já é filtrado), e a Server Action volta a checar o papel:
 * para quem não é administrador ela não devolve nenhum dado.
 */
export function IndicadorRevisao({ colapsada }: { colapsada: boolean }) {
  const [pendentes, setPendentes] = useState(0);

  const atualizar = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    try {
      const r = await contarVendasRevisaoAction();
      setPendentes(r.ok ? r.pendentes : 0);
    } catch {
      // sem conexão: mantém o último valor conhecido
    }
  }, []);

  useEffect(() => {
    void atualizar();
    const intervalo = setInterval(atualizar, INTERVALO_MS);
    window.addEventListener("online", atualizar);
    window.addEventListener("focus", atualizar);
    window.addEventListener(EVENTO_ATUALIZAR_REVISAO, atualizar);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener("online", atualizar);
      window.removeEventListener("focus", atualizar);
      window.removeEventListener(EVENTO_ATUALIZAR_REVISAO, atualizar);
    };
  }, [atualizar]);

  if (pendentes === 0) return null;

  const texto = pendentes > 99 ? "99+" : String(pendentes);
  const rotulo = `${pendentes} venda${pendentes === 1 ? "" : "s"} aguardando revisão`;

  return (
    <span
      data-testid="indicador-revisao"
      aria-label={rotulo}
      title={rotulo}
      className={
        colapsada
          ? "absolute right-1.5 top-1 min-w-4 h-4 px-1 rounded-full bg-danger-600 text-white text-[10px] font-bold leading-4 text-center"
          : "ml-auto min-w-5 h-5 px-1.5 rounded-full bg-danger-600 text-white text-xs font-bold leading-5 text-center"
      }
    >
      {texto}
    </span>
  );
}
