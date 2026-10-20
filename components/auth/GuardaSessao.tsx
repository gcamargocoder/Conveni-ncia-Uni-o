"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LogIn, WifiOff } from "lucide-react";
import { logoutAction, verificarSessaoAction } from "@/lib/auth/sessao-actions";
import {
  CHAVE_LOGOUT_PENDENTE,
  EstadoAcesso,
  RespostaServidor,
  apagarMarcador,
  decidirAcesso,
  gravarMarcador,
  lerMarcador,
} from "@/lib/auth/sessao-offline";
import { limparCachesDoServiceWorker } from "@/lib/auth/limpar-caches";
import { limparCredenciaisPinLocal } from "@/services/offline/credenciais-pin-local.service";

const INTERVALO_REVALIDACAO_MS = 5 * 60 * 1000;
const TEMPO_LIMITE_CONSULTA_MS = 8000;

async function consultarServidor(): Promise<{ resposta: RespostaServidor; dados?: Awaited<ReturnType<typeof verificarSessaoAction>> }> {
  try {
    const dados = await Promise.race([
      verificarSessaoAction(),
      new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error("timeout")), TEMPO_LIMITE_CONSULTA_MS)),
    ]);
    return { resposta: dados.autenticado ? "autenticado" : "nao_autenticado", dados };
  } catch {
    return { resposta: "indisponivel" };
  }
}

/**
 * Mantém o PDV utilizável offline dentro de limites seguros (ver
 * lib/auth/sessao-offline.ts) e encerra o acesso quando o servidor informa
 * que a sessão acabou. Nunca apaga a fila de vendas pendentes: ela continua no
 * IndexedDB e é enviada assim que alguém entrar de novo.
 */
export function GuardaSessao({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<EstadoAcesso>("liberado");
  const verificando = useRef(false);

  const verificar = useCallback(async () => {
    if (verificando.current) return;
    verificando.current = true;
    try {
      // Um logout feito sem conexão fica pendente até o servidor ser alcançado.
      if (localStorage.getItem(CHAVE_LOGOUT_PENDENTE) === "1" && navigator.onLine) {
        try {
          await logoutAction();
          localStorage.removeItem(CHAVE_LOGOUT_PENDENTE);
        } catch {
          // continua pendente
        }
      }
      if (localStorage.getItem(CHAVE_LOGOUT_PENDENTE) === "1") {
        setEstado("sessao_encerrada");
        return;
      }

      const { resposta, dados } = await consultarServidor();
      const agora = Date.now();

      if (resposta === "autenticado" && dados?.usuario && dados.expiraAbsolutaEm) {
        gravarMarcador(localStorage, {
          usuarioId: dados.usuario.id,
          nome: dados.usuario.nome,
          papel: dados.usuario.papel === "admin" ? "admin" : "operador",
          ultimaValidacaoEm: agora,
          expiraAbsolutaEm: new Date(dados.expiraAbsolutaEm).getTime(),
        });
      } else if (resposta === "nao_autenticado") {
        apagarMarcador(localStorage);
        void limparCredenciaisPinLocal();
        void limparCachesDoServiceWorker();
      }

      setEstado(decidirAcesso(lerMarcador(localStorage), resposta, agora));
    } catch {
      setEstado("bloqueado_offline");
    } finally {
      verificando.current = false;
    }
  }, []);

  useEffect(() => {
    verificar();
    const intervalo = setInterval(verificar, INTERVALO_REVALIDACAO_MS);
    window.addEventListener("online", verificar);
    document.addEventListener("visibilitychange", verificar);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener("online", verificar);
      document.removeEventListener("visibilitychange", verificar);
    };
  }, [verificar]);

  if (estado === "liberado") return <>{children}</>;

  const offline = estado === "bloqueado_offline";
  const Icone = offline ? WifiOff : LogIn;

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="guarda-titulo">
        <div className="w-full max-w-sm rounded-xl bg-white shadow-elevated p-6 flex flex-col gap-4 text-center items-center">
          <div className="w-12 h-12 rounded-full bg-warning-50 flex items-center justify-center">
            <Icone className="w-6 h-6 text-warning-600" />
          </div>
          <div>
            <h2 id="guarda-titulo" className="text-lg font-bold text-slate-900">
              {offline ? "Reconecte para continuar" : "Sua sessão terminou"}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {offline
                ? "Este dispositivo ficou tempo demais sem confirmar a sessão com o servidor. Conecte-se à internet para continuar."
                : "Entre novamente para continuar. As vendas já registradas neste aparelho estão guardadas e serão enviadas após o login."}
            </p>
          </div>
          {!offline && (
            <a
              href={`/login?next=${encodeURIComponent(window.location.pathname)}`}
              className="inline-flex items-center justify-center h-11 px-6 rounded-lg bg-brand-700 text-white font-semibold hover:bg-brand-900 w-full"
            >
              Entrar
            </a>
          )}
          {offline && (
            <button onClick={verificar} className="inline-flex items-center justify-center h-11 px-6 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 w-full">
              Tentar novamente
            </button>
          )}
        </div>
      </div>
      {/* conteúdo permanece montado por baixo (estado do carrinho preservado) mas inacessível */}
      <div aria-hidden="true" inert>
        {children}
      </div>
    </>
  );
}
