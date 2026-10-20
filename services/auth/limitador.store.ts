import { prisma } from "../prisma/client";
import {
  ConfigLimite,
  EstadoLimite,
  bloqueioRestanteMs,
  registrarFalhaEstado,
} from "@/lib/auth/limitador";

/**
 * Armazenamento persistente do limitador (tabela limites_tentativa). Fica no
 * banco — e não em memória, navegador ou cookie — para valer igualmente em
 * qualquer instância do servidor e sobreviver a reinícios.
 */

/** Maior tempo de bloqueio restante entre as chaves informadas (0 = livre). */
export async function bloqueioRestante(chaves: string[], agora = new Date()): Promise<number> {
  const linhas = await prisma.limiteTentativa.findMany({ where: { chave: { in: chaves } } });
  return linhas.reduce((maior, l) => Math.max(maior, bloqueioRestanteMs(l, agora)), 0);
}

/**
 * Registra uma falha (ou um pedido, para limites de taxa) de forma atômica:
 * a linha é travada com FOR UPDATE, então tentativas simultâneas não "furam" o
 * contador.
 */
export async function registrarFalha(
  chave: string,
  config: ConfigLimite,
  agora = new Date()
): Promise<EstadoLimite> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO limites_tentativa (chave) VALUES (${chave}) ON CONFLICT (chave) DO NOTHING`;
    const [atual] = await tx.$queryRaw<EstadoLimite[]>`
      SELECT falhas, nivel, bloqueado_ate, atualizado_em
      FROM limites_tentativa WHERE chave = ${chave} FOR UPDATE`;

    // linha recém-criada (sem falhas, nível ou bloqueio) não conta como histórico
    const historico = atual.falhas === 0 && atual.nivel === 0 && !atual.bloqueado_ate ? null : atual;
    const novo = registrarFalhaEstado(historico, agora, config);

    await tx.limiteTentativa.update({
      where: { chave },
      data: {
        falhas: novo.falhas,
        nivel: novo.nivel,
        bloqueado_ate: novo.bloqueado_ate,
        atualizado_em: novo.atualizado_em,
      },
    });
    return novo;
  });
}

/**
 * Reserva UMA tentativa de forma atômica: conta ANTES de agir (a linha é travada com FOR UPDATE),
 * então requisições simultâneas se enfileiram e só as que cabem no limite são permitidas — ao
 * contrário de "conferir bloqueio → agir → contar", que deixa uma rajada inteira passar.
 * Tolera `limite` tentativas por janela; a seguinte já é recusada e dispara o bloqueio.
 */
export async function reservarTentativa(
  chave: string,
  config: ConfigLimite,
  agora = new Date()
): Promise<{ permitida: boolean; esperaMs: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO limites_tentativa (chave) VALUES (${chave}) ON CONFLICT (chave) DO NOTHING`;
    const [atual] = await tx.$queryRaw<EstadoLimite[]>`
      SELECT falhas, nivel, bloqueado_ate, atualizado_em
      FROM limites_tentativa WHERE chave = ${chave} FOR UPDATE`;

    // Já bloqueada: recusa SEM contar (uma rajada que chegou durante o bloqueio não o escala).
    const restante = bloqueioRestanteMs(atual, agora);
    if (restante > 0) return { permitida: false, esperaMs: restante };

    const historico = atual.falhas === 0 && atual.nivel === 0 && !atual.bloqueado_ate ? null : atual;
    const novo = registrarFalhaEstado(historico, agora, { ...config, limite: config.limite + 1 });
    await tx.limiteTentativa.update({
      where: { chave },
      data: { falhas: novo.falhas, nivel: novo.nivel, bloqueado_ate: novo.bloqueado_ate, atualizado_em: novo.atualizado_em },
    });
    const esperaMs = bloqueioRestanteMs(novo, agora);
    return { permitida: esperaMs === 0, esperaMs };
  });
}

/** Devolve uma tentativa reservada (ex.: login bem-sucedido não deve consumir o limite do IP). Atômico. */
export async function devolverTentativa(chave: string, agora = new Date()): Promise<void> {
  await prisma.$executeRaw`UPDATE limites_tentativa SET falhas = GREATEST(falhas - 1, 0)
    WHERE chave = ${chave} AND (bloqueado_ate IS NULL OR bloqueado_ate <= ${agora})`;
}

export async function limparChave(chave: string): Promise<void> {
  await prisma.limiteTentativa.deleteMany({ where: { chave } });
}

/** Faxina oportunista de linhas antigas (chamada de vez em quando). */
export async function limparExpirados(agora = new Date()): Promise<void> {
  const corte = new Date(agora.getTime() - 48 * 60 * 60 * 1000);
  await prisma.limiteTentativa.deleteMany({ where: { atualizado_em: { lt: corte } } });
  await prisma.sessao.deleteMany({
    where: { OR: [{ expira_absoluta_em: { lt: agora } }, { expira_em: { lt: agora } }] },
  });
  await prisma.tokenRecuperacao.deleteMany({
    where: { OR: [{ expira_em: { lt: corte } }, { usado_em: { lt: corte } }] },
  });
}
