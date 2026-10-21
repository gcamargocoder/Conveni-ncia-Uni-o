"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/lib/auth/sessao-actions";
import { CHAVE_LOGOUT_PENDENTE, apagarMarcador } from "@/lib/auth/sessao-offline";
import { limparCachesDoServiceWorker } from "@/lib/auth/limpar-caches";
import { limparCredenciaisPinLocal } from "@/services/offline/credenciais-pin-local.service";

/**
 * Encerra a sessão: invalida no servidor, apaga o marcador offline e
 * limpa os caches do service worker (que guardam páginas com dados do negócio).
 * A fila de vendas pendentes NÃO é apagada — ela é enviada no próximo login.
 */
export function BotaoSair({ colapsada = false }: { colapsada?: boolean }) {
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    if (saindo) return;
    setSaindo(true);

    try {
      await logoutAction();
      localStorage.removeItem(CHAVE_LOGOUT_PENDENTE);
    } catch {
      // Sem conexão: o cookie HttpOnly não pode ser apagado daqui. Guardamos a
      // intenção e o servidor é avisado assim que a conexão voltar.
      try {
        localStorage.setItem(CHAVE_LOGOUT_PENDENTE, "1");
      } catch {
        // nada a fazer
      }
    }

    try {
      apagarMarcador(localStorage);
    } catch {
      // nada a fazer
    }
    await limparCredenciaisPinLocal();
    await limparCachesDoServiceWorker();

    window.location.assign("/login");
  }

  return (
    <button
      onClick={sair}
      disabled={saindo}
      title="Sair"
      className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 transition-colors"
    >
      <LogOut className="w-4 h-4 shrink-0" />
      {!colapsada && (saindo ? "Saindo..." : "Sair")}
    </button>
  );
}
