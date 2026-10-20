/**
 * Constantes de autenticação seguras para o runtime Edge (usadas pelo
 * middleware) — por isso não importam nada de Node, Prisma ou next/headers.
 */

export const EM_PRODUCAO = process.env.NODE_ENV === "production";

/**
 * Em produção o prefixo `__Host-` obriga o navegador a só aceitar o cookie se
 * ele for Secure, Path=/ e sem Domain — impede que um subdomínio o sobrescreva.
 * Em desenvolvimento (http://localhost) o prefixo não pode ser usado.
 */
export const COOKIE_SESSAO = EM_PRODUCAO ? "__Host-sessao" : "sessao";

const HORA = 60 * 60 * 1000;
const MINUTO = 60 * 1000;

/** Inatividade máxima: a sessão expira se ficar este tempo sem nenhuma requisição. */
export const SESSAO_INATIVIDADE_MS = 12 * HORA;
/** Teto absoluto: mesmo com uso contínuo, é preciso entrar de novo após este prazo. */
export const SESSAO_ABSOLUTA_MS = 7 * 24 * HORA;
/** A renovação da inatividade só grava no banco se o último uso for mais antigo que isto. */
export const SESSAO_RENOVAR_APOS_MS = 5 * MINUTO;

/** Validade do link de recuperação de senha. */
export const TOKEN_RECUPERACAO_MS = 30 * MINUTO;

/** Validade do link de ativação inicial da conta principal. */
export const TOKEN_ATIVACAO_MS = 30 * MINUTO;

/**
 * Por quanto tempo um dispositivo que já estava autenticado pode continuar
 * operando o PDV SEM conseguir falar com o servidor (modo offline), contado
 * desde a última validação online da sessão. Nunca ultrapassa o teto absoluto.
 */
export const OFFLINE_MAXIMO_MS =
  Number(process.env.NEXT_PUBLIC_SESSAO_OFFLINE_HORAS ?? "72") * HORA;

/** Rotas que não exigem sessão. Todo o resto exige. */
export const ROTAS_PUBLICAS = ["/login", "/recuperar-senha", "/redefinir-senha", "/offline", "/configurar-conta", "/ativar-conta"];

export function rotaPublica(pathname: string): boolean {
  return ROTAS_PUBLICAS.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/**
 * Impede open redirect: só aceita caminhos internos ("/algo"), nunca
 * "//outro.com", "/\outro.com" ou URLs absolutas. Qualquer outra coisa → "/".
 */
export function destinoSeguro(destino: string | null | undefined): string {
  if (!destino || typeof destino !== "string") return "/";
  if (!destino.startsWith("/")) return "/";
  if (destino.startsWith("//") || destino.includes("\\")) return "/";
  if (/[\u0000-\u001f]/.test(destino)) return "/";
  if (rotaPublica(destino.split("?")[0])) return "/";
  return destino;
}

export type PapelUsuario = "admin" | "operador";
