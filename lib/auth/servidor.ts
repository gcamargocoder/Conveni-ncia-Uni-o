import * as React from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { validarSessao, SessaoAtiva } from "@/services/auth/sessao.service";
import { COOKIE_SESSAO, EM_PRODUCAO } from "@/lib/auth/constantes";
import { ipDoCliente } from "@/lib/auth/ip";

/**
 * Camada de autenticação para código de SERVIDOR (páginas, Server Actions).
 * O middleware faz só um filtro grosseiro por presença do cookie; a decisão
 * real — sessão existe, não expirou, usuário ativo, papel — é sempre tomada
 * aqui, contra o banco, a cada requisição que toca em dados.
 */

// `cache` memoiza por requisição (layout + página não consultam o banco duas vezes).
// Fora do runtime de Server Components (ex.: testes) vira identidade.
const memoizar: <T extends (...args: never[]) => unknown>(fn: T) => T =
  (React as unknown as { cache?: <T>(fn: T) => T }).cache ?? ((fn) => fn);

export const MENSAGEM_NAO_AUTENTICADO = "Sua sessão expirou. Entre novamente para continuar.";
export const MENSAGEM_NAO_AUTORIZADO = "Acesso restrito a administradores.";

export async function obterIp(): Promise<string> {
  const h = await headers();
  // `x-real-ip` é definido pelo proxy do Railway (o cliente não o controla);
  // `x-forwarded-for` pode vir forjado no primeiro item, então só é fallback.
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0].trim() ?? "desconhecido";
  return ip.slice(0, 64);
}

/**
 * IP confiável para limitação de login, recuperação e ativação (ver `ipDoCliente`). O limitador de PIN
 * continua usando `obterIp`, sem alteração.
 */
export async function obterIpConfiavel(): Promise<string> {
  const h = await headers();
  return ipDoCliente((nome) => h.get(nome));
}

export async function obterUserAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

export const obterSessaoAtual = memoizar(async (): Promise<SessaoAtiva | null> => {
  const token = (await cookies()).get(COOKIE_SESSAO)?.value;
  return validarSessao(token);
});

async function caminhoAtual(): Promise<string> {
  return (await headers()).get("x-pathname") ?? "/";
}

/** Para páginas e layouts: sem sessão válida, redireciona para /login. */
export async function exigirSessao(): Promise<SessaoAtiva> {
  const sessao = await obterSessaoAtual();
  if (!sessao) {
    const destino = await caminhoAtual();
    redirect(destino === "/" ? "/login" : `/login?next=${encodeURIComponent(destino)}`);
  }
  return sessao;
}

/** Para páginas administrativas: logado mas sem ser admin volta ao início. */
export async function exigirAdmin(): Promise<SessaoAtiva> {
  const sessao = await exigirSessao();
  if (sessao.usuario.papel !== "admin") redirect("/");
  return sessao;
}

export type ResultadoAcesso = { ok: true; sessao: SessaoAtiva } | { ok: false; erro: string };

/**
 * Para Server Actions: nunca redireciona nem lança — devolve um resultado
 * para a action responder no formato que a tela já espera. TODA Server Action
 * (exceto as públicas de login/recuperação) precisa chamar isto como primeira
 * instrução; um teste automatizado garante.
 */
export async function verificarAcesso(nivel: "usuario" | "admin" = "usuario"): Promise<ResultadoAcesso> {
  let sessao: SessaoAtiva | null = null;
  try {
    sessao = await obterSessaoAtual();
  } catch (e) {
    console.error(`[auth] erro ao validar sessão: ${(e as Error).name}`);
  }
  if (!sessao) return { ok: false, erro: MENSAGEM_NAO_AUTENTICADO };
  if (nivel === "admin" && sessao.usuario.papel !== "admin") return { ok: false, erro: MENSAGEM_NAO_AUTORIZADO };
  return { ok: true, sessao };
}

export async function definirCookieSessao(token: string, expiraEm: Date): Promise<void> {
  (await cookies()).set(COOKIE_SESSAO, token, {
    httpOnly: true,
    secure: EM_PRODUCAO,
    sameSite: "lax",
    path: "/",
    expires: expiraEm,
  });
}

export async function lerTokenDoCookie(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE_SESSAO)?.value;
}

export async function limparCookieSessao(): Promise<void> {
  (await cookies()).set(COOKIE_SESSAO, "", {
    httpOnly: true,
    secure: EM_PRODUCAO,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
