"use server";

import { confirmarAtivacao, solicitarAtivacao, tokenAtivacaoValido } from "@/services/auth/ativacao.service";
import { obterIpConfiavel } from "@/lib/auth/servidor";
import { formatarEspera } from "@/lib/auth/limitador";

/**
 * Server Actions PÚBLICAS da ativação inicial da conta principal. Só funcionam enquanto não
 * existir nenhum usuário E o código de inicialização estiver configurado no servidor; a
 * autorização é revalidada no servidor a cada chamada (services/auth/ativacao.service.ts).
 */

export interface ResultadoAtivacaoAction {
  sucesso: boolean;
  erro?: string;
}

const INDISPONIVEL = "A configuração inicial não está disponível.";
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";

/** Erro inesperado: registra só o NOME do erro (a mensagem pode conter dados do pedido) e devolve texto genérico. */
function falhaInesperada(e: unknown): ResultadoAtivacaoAction {
  console.error(`[ativacao] erro inesperado: ${(e as Error)?.name ?? "desconhecido"}`);
  return { sucesso: false, erro: ERRO_GENERICO };
}

export async function solicitarAtivacaoAction(entrada: {
  codigo: string;
  nome: string;
  email: string;
  senha: string;
  confirmacao: string;
}): Promise<ResultadoAtivacaoAction> {
  const campos = [entrada?.codigo, entrada?.nome, entrada?.email, entrada?.senha, entrada?.confirmacao];
  if (!campos.every((v) => typeof v === "string")) return { sucesso: false, erro: "Pedido inválido." };
  if (entrada.senha !== entrada.confirmacao) return { sucesso: false, erro: "A confirmação não é igual à senha." };

  let r;
  try {
    r = await solicitarAtivacao({
      codigo: entrada.codigo,
      nome: entrada.nome,
      email: entrada.email,
      senha: entrada.senha,
      ip: await obterIpConfiavel(),
    });
  } catch (e) {
    return falhaInesperada(e);
  }
  if (r.ok) return { sucesso: true };
  switch (r.motivo) {
    case "indisponivel":
      return { sucesso: false, erro: INDISPONIVEL };
    case "codigo_invalido":
      return { sucesso: false, erro: "Código de inicialização inválido." };
    case "bloqueado":
      return { sucesso: false, erro: `Muitas tentativas. Tente novamente em ${formatarEspera(r.esperaMs)}.` };
    case "dados_invalidos":
      return { sucesso: false, erro: r.erro };
    case "email_nao_configurado":
      return { sucesso: false, erro: "O envio de e-mail não está configurado no servidor. A conta não foi ativada." };
    default:
      return { sucesso: false, erro: "Não foi possível enviar o e-mail de confirmação. Tente novamente." };
  }
}

export async function confirmarAtivacaoAction(token: string): Promise<ResultadoAtivacaoAction> {
  if (typeof token !== "string") return { sucesso: false, erro: "Pedido inválido." };
  let r;
  try {
    r = await confirmarAtivacao({ token, ip: await obterIpConfiavel() });
  } catch (e) {
    return falhaInesperada(e);
  }
  if (r.ok) return { sucesso: true };
  if (r.motivo === "bloqueado") return { sucesso: false, erro: `Muitas tentativas. Tente novamente em ${formatarEspera(r.esperaMs)}.` };
  if (r.motivo === "encerrada") return { sucesso: false, erro: INDISPONIVEL };
  return { sucesso: false, erro: "Este link é inválido, já foi usado ou expirou." };
}

export async function validarTokenAtivacaoAction(token: string): Promise<boolean> {
  if (typeof token !== "string") return false;
  try {
    return await tokenAtivacaoValido(token);
  } catch (e) {
    falhaInesperada(e);
    return false;
  }
}
