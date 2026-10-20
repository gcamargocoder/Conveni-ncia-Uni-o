"use server";

import { revalidatePath } from "next/cache";
import { verificarAcesso } from "@/lib/auth/servidor";
import {
  definirAtivo,
  definirPapel,
  redefinirAcesso,
  ErroUsuario,
  UsuarioListado,
} from "@/services/usuarios.service";
import { PapelUsuario } from "@/lib/auth/constantes";

export interface ResultadoAcaoUsuario {
  sucesso: boolean;
  erro?: string;
  aviso?: string;
  usuario?: UsuarioListado;
}

function mensagem(e: unknown): string {
  if (e instanceof ErroUsuario) return e.message;
  console.error(`[usuarios] erro inesperado: ${(e as Error).name}`);
  return "Não foi possível concluir a operação.";
}

// Toda ação abaixo exige papel de administrador, verificado no servidor.
// Não há ação de criar contas: existe uma única conta principal de login (AUTENTICACAO.md).

export async function alterarAtivoUsuarioAction(id: string, ativo: boolean): Promise<ResultadoAcaoUsuario> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };

  try {
    await definirAtivo(id, ativo === true, acesso.sessao.usuario.id);
    revalidatePath("/usuarios");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: mensagem(e) };
  }
}

export async function alterarPapelUsuarioAction(id: string, papel: PapelUsuario): Promise<ResultadoAcaoUsuario> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };

  try {
    await definirPapel(id, papel, acesso.sessao.usuario.id);
    revalidatePath("/usuarios");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: mensagem(e) };
  }
}

export async function redefinirAcessoUsuarioAction(id: string): Promise<ResultadoAcaoUsuario> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };

  try {
    const envio = await redefinirAcesso(id);
    revalidatePath("/usuarios");
    if (!envio.enviado) {
      return {
        sucesso: false,
        erro:
          envio.motivo === "nao_configurado"
            ? "As sessões do usuário foram encerradas, mas o e-mail não está configurado no servidor (RESEND_API_KEY, EMAIL_FROM, APP_URL)."
            : "As sessões do usuário foram encerradas, mas o provedor de e-mail recusou o envio. Tente novamente.",
      };
    }
    return { sucesso: true, aviso: "Sessões encerradas e link de nova senha enviado por e-mail." };
  } catch (e) {
    return { sucesso: false, erro: mensagem(e) };
  }
}
