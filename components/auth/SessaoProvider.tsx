"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { lerMarcador } from "@/lib/auth/sessao-offline";

export interface UsuarioSessao {
  id: string;
  nome: string;
  email: string;
  papel: "admin" | "operador";
}

interface SessaoContextValue {
  usuario: UsuarioSessao | null;
  expiraAbsolutaEm: string | null;
}

const SessaoContext = createContext<SessaoContextValue>({ usuario: null, expiraAbsolutaEm: null });

/**
 * Dados NÃO secretos da sessão, vindos do servidor, só para a interface (nome, papel).
 *
 * Na cópia "neutra" do HTML (a que o service worker guarda para o uso offline, ver app/layout.tsx)
 * o servidor NÃO envia a pessoa logada (`neutro` = true, `usuario` = null). Nesse caso a interface
 * usa o marcador local da sessão (nome e papel, sem e-mail), que o logout apaga: sem marcador não
 * aparece identidade nenhuma. O HTML guardado, portanto, nunca contém dados da sessão anterior.
 */
export function SessaoProvider({
  usuario,
  expiraAbsolutaEm,
  neutro = false,
  children,
}: SessaoContextValue & { neutro?: boolean; children: ReactNode }) {
  const [local, setLocal] = useState<UsuarioSessao | null>(null);

  useEffect(() => {
    if (!neutro) return;
    const m = lerMarcador(localStorage);
    setLocal(m ? { id: m.usuarioId, nome: m.nome, email: "", papel: m.papel ?? "operador" } : null);
  }, [neutro]);

  return <SessaoContext.Provider value={{ usuario: neutro ? local : usuario, expiraAbsolutaEm }}>{children}</SessaoContext.Provider>;
}

export function useSessao(): SessaoContextValue {
  return useContext(SessaoContext);
}
