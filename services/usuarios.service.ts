import { prisma } from "./prisma/client";
import { emitirRecuperacao } from "./auth/auth.service";
import { revogarSessoesDoUsuario } from "./auth/sessao.service";
import { PapelUsuario } from "@/lib/auth/constantes";
import { ResultadoEnvioEmail } from "@/lib/email/enviar";

export interface UsuarioListado {
  id: string;
  nome: string;
  email: string;
  papel: PapelUsuario;
  ativo: boolean;
  ultimo_login_em: string | null;
  created_at: string;
}

export class ErroUsuario extends Error {}

const SELECAO = {
  id: true,
  nome: true,
  email: true,
  papel: true,
  ativo: true,
  ultimo_login_em: true,
  created_at: true,
} as const;

function serializar(u: {
  id: string;
  nome: string;
  email: string;
  papel: string;
  ativo: boolean;
  ultimo_login_em: Date | null;
  created_at: Date;
}): UsuarioListado {
  return {
    ...u,
    papel: u.papel as PapelUsuario,
    ultimo_login_em: u.ultimo_login_em?.toISOString() ?? null,
    created_at: u.created_at.toISOString(),
  };
}

export async function listarUsuarios(): Promise<UsuarioListado[]> {
  const usuarios = await prisma.usuario.findMany({ select: SELECAO, orderBy: [{ ativo: "desc" }, { nome: "asc" }] });
  return usuarios.map(serializar);
}

export async function contarAdminsAtivos(): Promise<number> {
  return prisma.usuario.count({ where: { papel: "admin", ativo: true } });
}

/**
 * Altera papel/ativo garantindo, dentro de uma transação que trava as linhas
 * de administradores, que o sistema nunca fica sem nenhum admin ativo — nem
 * por duas requisições simultâneas — e que ninguém se tranca para fora.
 */
async function alterarComGuardaDeAdmin(
  alvoId: string,
  executorId: string,
  mudanca: { ativo?: boolean; papel?: PapelUsuario }
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM usuarios WHERE papel = 'admin' AND ativo = true FOR UPDATE`;

    const alvo = await tx.usuario.findUnique({ where: { id: alvoId } });
    if (!alvo) throw new ErroUsuario("Usuário não encontrado.");

    if (alvoId === executorId && mudanca.ativo === false) {
      throw new ErroUsuario("Você não pode desativar o seu próprio acesso.");
    }

    const novoAtivo = mudanca.ativo ?? alvo.ativo;
    const novoPapel = mudanca.papel ?? (alvo.papel as PapelUsuario);
    const eraAdminAtivo = alvo.papel === "admin" && alvo.ativo;
    const seraAdminAtivo = novoPapel === "admin" && novoAtivo;

    if (eraAdminAtivo && !seraAdminAtivo) {
      const outros = await tx.usuario.count({ where: { papel: "admin", ativo: true, id: { not: alvoId } } });
      if (outros === 0) {
        throw new ErroUsuario("Esta é a última conta de administrador ativa — o acesso administrativo não pode ser removido.");
      }
    }

    await tx.usuario.update({ where: { id: alvoId }, data: { ativo: novoAtivo, papel: novoPapel } });
    if (!novoAtivo || novoPapel !== alvo.papel) {
      // desativação ou troca de papel encerra as sessões na hora
      await tx.sessao.deleteMany({ where: { usuario_id: alvoId } });
    }
  });
}

export async function definirAtivo(alvoId: string, ativo: boolean, executorId: string): Promise<void> {
  await alterarComGuardaDeAdmin(alvoId, executorId, { ativo });
}

export async function definirPapel(alvoId: string, papel: PapelUsuario, executorId: string): Promise<void> {
  if (papel !== "admin" && papel !== "operador") throw new ErroUsuario("Papel inválido.");
  await alterarComGuardaDeAdmin(alvoId, executorId, { papel });
}

/**
 * "Redefinir acesso": encerra todas as sessões do usuário e envia a ele um
 * link de nova senha. A senha nunca passa pelo administrador.
 */
export async function redefinirAcesso(alvoId: string): Promise<ResultadoEnvioEmail> {
  const alvo = await prisma.usuario.findUnique({ where: { id: alvoId } });
  if (!alvo) throw new ErroUsuario("Usuário não encontrado.");
  if (!alvo.ativo) throw new ErroUsuario("Usuário desativado — reative-o antes de redefinir o acesso.");

  await revogarSessoesDoUsuario(alvoId);
  return emitirRecuperacao(alvo);
}
