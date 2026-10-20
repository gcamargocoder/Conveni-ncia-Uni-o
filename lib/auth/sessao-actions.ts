"use server";

import {
  autenticar,
  redefinirSenha,
  solicitarRecuperacao,
  tokenRecuperacaoValido,
} from "@/services/auth/auth.service";
import { revogarSessaoPorToken } from "@/services/auth/sessao.service";
import {
  definirCookieSessao,
  lerTokenDoCookie,
  limparCookieSessao,
  obterIpConfiavel,
  obterSessaoAtual,
  obterUserAgent,
} from "@/lib/auth/servidor";
import { destinoSeguro } from "@/lib/auth/constantes";
import { formatarEspera } from "@/lib/auth/limitador";
import { emailValido, normalizarEmail } from "@/lib/auth/senha";

/**
 * Server Actions PÚBLICAS de autenticação (as únicas que dispensam sessão).
 * O Next já valida Origin/Host em toda Server Action (proteção CSRF) e o
 * cookie é SameSite=Lax, então um site de terceiros não consegue acioná-las
 * com a sessão do usuário.
 */

export interface ResultadoLoginAction {
  sucesso: boolean;
  erro?: string;
  destino?: string;
  /** Dados não secretos para o cliente controlar o limite de uso offline. */
  sessao?: { expiraAbsolutaEm: string; usuario: { id: string; nome: string; papel: string } };
}

const ERRO_CREDENCIAIS = "E-mail ou senha incorretos.";
const ERRO_INTERNO = "Não foi possível concluir a operação agora. Tente novamente.";

/** Erro inesperado: registra só o NOME do erro (a mensagem pode trazer senha, hash, token ou texto do banco). */
function registrarErroInesperado(contexto: string, e: unknown): void {
  console.error(`[auth] erro inesperado em ${contexto}: ${(e as Error)?.name ?? "desconhecido"}`);
}

export async function loginAction(entrada: {
  email: string;
  senha: string;
  next?: string | null;
}): Promise<ResultadoLoginAction> {
  if (typeof entrada?.email !== "string" || typeof entrada?.senha !== "string") {
    return { sucesso: false, erro: ERRO_CREDENCIAIS };
  }
  const email = normalizarEmail(entrada.email);
  if (!email || !entrada.senha) return { sucesso: false, erro: "Informe o e-mail e a senha." };

  let resultado;
  try {
    resultado = await autenticar({
      email,
      senha: entrada.senha,
      ip: await obterIpConfiavel(),
      userAgent: await obterUserAgent(),
    });
  } catch (e) {
    registrarErroInesperado("login", e);
    return { sucesso: false, erro: ERRO_INTERNO };
  }

  if (!resultado.ok) {
    return {
      sucesso: false,
      erro:
        resultado.motivo === "bloqueado"
          ? `Muitas tentativas. Tente novamente em ${formatarEspera(resultado.esperaMs)}.`
          : ERRO_CREDENCIAIS,
    };
  }

  await definirCookieSessao(resultado.token, resultado.expiraAbsolutaEm);
  return {
    sucesso: true,
    destino: destinoSeguro(entrada.next),
    sessao: {
      expiraAbsolutaEm: resultado.expiraAbsolutaEm.toISOString(),
      usuario: { id: resultado.usuario.id, nome: resultado.usuario.nome, papel: resultado.usuario.papel },
    },
  };
}

export async function logoutAction(): Promise<{ sucesso: boolean }> {
  await revogarSessaoPorToken(await lerTokenDoCookie());
  await limparCookieSessao();
  return { sucesso: true };
}

export interface ResultadoSimples {
  sucesso: boolean;
  erro?: string;
}

const MENSAGEM_RECUPERACAO =
  "Se este e-mail estiver cadastrado, enviaremos as instruções para redefinir a senha.";

export async function solicitarRecuperacaoAction(entrada: { email: string }): Promise<ResultadoSimples & { mensagem: string }> {
  const email = typeof entrada?.email === "string" ? normalizarEmail(entrada.email) : "";
  if (!emailValido(email)) {
    return { sucesso: false, erro: "Informe um e-mail válido.", mensagem: "" };
  }

  // O envio roda em segundo plano; a resposta é a mesma exista o e-mail ou não.
  try {
    await solicitarRecuperacao({ email, ip: await obterIpConfiavel() });
  } catch (e) {
    // mesma resposta de sempre: uma falha interna não pode virar oráculo de "o e-mail existe"
    registrarErroInesperado("recuperação", e);
  }
  return { sucesso: true, mensagem: MENSAGEM_RECUPERACAO };
}

export async function redefinirSenhaAction(entrada: {
  token: string;
  senha: string;
  confirmacao: string;
}): Promise<ResultadoSimples> {
  if (typeof entrada?.token !== "string" || typeof entrada?.senha !== "string") {
    return { sucesso: false, erro: "Pedido inválido." };
  }
  if (entrada.senha !== entrada.confirmacao) {
    return { sucesso: false, erro: "A confirmação não é igual à nova senha." };
  }

  let resultado;
  try {
    resultado = await redefinirSenha({
      token: entrada.token,
      novaSenha: entrada.senha,
      ip: await obterIpConfiavel(),
    });
  } catch (e) {
    registrarErroInesperado("redefinição", e);
    return { sucesso: false, erro: ERRO_INTERNO };
  }

  if (resultado.ok) return { sucesso: true };
  if (resultado.motivo === "senha_fraca") return { sucesso: false, erro: resultado.erros[0] };
  if (resultado.motivo === "bloqueado") {
    return { sucesso: false, erro: `Muitas tentativas. Tente novamente em ${formatarEspera(resultado.esperaMs)}.` };
  }
  return { sucesso: false, erro: "Este link é inválido ou expirou. Solicite um novo." };
}

export async function validarTokenRecuperacaoAction(token: string): Promise<boolean> {
  if (typeof token !== "string") return false;
  try {
    return await tokenRecuperacaoValido(token);
  } catch (e) {
    registrarErroInesperado("validação do token", e);
    return false;
  }
}

/**
 * Consulta usada pelo cliente (PDV) para saber se a sessão continua válida
 * e renovar o marcador de "última validação online". Só informa sobre a
 * própria sessão de quem pergunta.
 */
export async function verificarSessaoAction(): Promise<{
  autenticado: boolean;
  expiraAbsolutaEm?: string;
  usuario?: { id: string; nome: string; papel: string };
}> {
  const sessao = await obterSessaoAtual();
  if (!sessao) return { autenticado: false };
  return {
    autenticado: true,
    expiraAbsolutaEm: sessao.expiraAbsolutaEm.toISOString(),
    usuario: { id: sessao.usuario.id, nome: sessao.usuario.nome, papel: sessao.usuario.papel },
  };
}
