import { prisma } from "../prisma/client";
import { gerarToken, hashToken } from "@/lib/auth/token";
import {
  SESSAO_ABSOLUTA_MS,
  SESSAO_INATIVIDADE_MS,
  SESSAO_RENOVAR_APOS_MS,
  PapelUsuario,
} from "@/lib/auth/constantes";

export interface SessaoAtiva {
  sessaoId: string;
  expiraEm: Date;
  expiraAbsolutaEm: Date;
  usuario: { id: string; email: string; nome: string; papel: PapelUsuario };
}

export async function criarSessao(
  usuarioId: string,
  contexto: { ip?: string | null; userAgent?: string | null },
  agora = new Date()
): Promise<{ token: string; expiraAbsolutaEm: Date }> {
  const token = gerarToken();
  const expiraAbsolutaEm = new Date(agora.getTime() + SESSAO_ABSOLUTA_MS);

  await prisma.sessao.create({
    data: {
      usuario_id: usuarioId,
      token_hash: hashToken(token),
      expira_em: new Date(agora.getTime() + SESSAO_INATIVIDADE_MS),
      expira_absoluta_em: expiraAbsolutaEm,
      ultimo_uso_em: agora,
      ip: contexto.ip?.slice(0, 64) ?? null,
      user_agent: contexto.userAgent?.slice(0, 300) ?? null,
    },
  });

  return { token, expiraAbsolutaEm };
}

/**
 * Valida o token do cookie contra o banco. Retorna null para qualquer motivo
 * de rejeição (inexistente, expirada, usuário desativado) — o chamador não
 * precisa (nem deve) diferenciar. Renova a janela de inatividade, gravando no
 * banco no máximo uma vez a cada SESSAO_RENOVAR_APOS_MS.
 */
export async function validarSessao(
  token: string | undefined | null,
  agora = new Date()
): Promise<SessaoAtiva | null> {
  if (!token || token.length > 200) return null;

  const sessao = await prisma.sessao.findUnique({
    where: { token_hash: hashToken(token) },
    include: { usuario: { select: { id: true, email: true, nome: true, papel: true, ativo: true } } },
  });

  if (!sessao) return null;

  const expirada = sessao.expira_em <= agora || sessao.expira_absoluta_em <= agora;
  if (expirada || !sessao.usuario.ativo) {
    await prisma.sessao.deleteMany({ where: { id: sessao.id } });
    return null;
  }

  let expiraEm = sessao.expira_em;
  if (agora.getTime() - sessao.ultimo_uso_em.getTime() > SESSAO_RENOVAR_APOS_MS) {
    expiraEm = new Date(
      Math.min(agora.getTime() + SESSAO_INATIVIDADE_MS, sessao.expira_absoluta_em.getTime())
    );
    await prisma.sessao.update({ where: { id: sessao.id }, data: { ultimo_uso_em: agora, expira_em: expiraEm } });
  }

  return {
    sessaoId: sessao.id,
    expiraEm,
    expiraAbsolutaEm: sessao.expira_absoluta_em,
    usuario: { ...sessao.usuario, papel: sessao.usuario.papel as PapelUsuario },
  };
}

export async function revogarSessaoPorToken(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await prisma.sessao.deleteMany({ where: { token_hash: hashToken(token) } });
}

export async function revogarSessoesDoUsuario(usuarioId: string): Promise<number> {
  const { count } = await prisma.sessao.deleteMany({ where: { usuario_id: usuarioId } });
  return count;
}
