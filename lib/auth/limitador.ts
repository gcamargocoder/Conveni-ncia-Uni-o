/**
 * Política pura de limitação de tentativas (sem banco): dado o estado atual
 * de uma chave, calcula o próximo. O armazenamento persistente (compartilhado
 * entre instâncias) fica em services/auth/limitador.store.ts.
 */

export interface ConfigLimite {
  /** Falhas toleradas dentro da janela antes de bloquear. */
  limite: number;
  /** Falhas "esquecidas" se a última tentativa for mais antiga que isto. */
  janelaMs: number;
  /** Duração do bloqueio por degrau (1º bloqueio, 2º, ...). O último se repete. */
  degrausMs: number[];
  /** Sem nenhuma tentativa por este tempo, o degrau volta a zero. */
  decaimentoMs: number;
}

export interface EstadoLimite {
  falhas: number;
  nivel: number;
  bloqueado_ate: Date | null;
  atualizado_em: Date;
}

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;

/** Por conta (e-mail): 5 erros em 15 min → 1 min, 5 min, 15 min, 1 h, 4 h... */
export const LIMITE_LOGIN_CONTA: ConfigLimite = {
  limite: 5,
  janelaMs: 15 * MINUTO,
  degrausMs: [1 * MINUTO, 5 * MINUTO, 15 * MINUTO, HORA, 4 * HORA],
  decaimentoMs: 24 * HORA,
};

/** Por IP: mais folgado, pois uma loja inteira pode sair pelo mesmo IP (NAT). */
export const LIMITE_LOGIN_IP: ConfigLimite = {
  limite: 20,
  janelaMs: 15 * MINUTO,
  degrausMs: [5 * MINUTO, 15 * MINUTO, HORA],
  decaimentoMs: 24 * HORA,
};

/** Pedidos de recuperação de senha: cada pedido conta; 5/hora por IP, 3/hora por e-mail. */
export const LIMITE_RECUPERACAO_IP: ConfigLimite = {
  limite: 5,
  janelaMs: HORA,
  degrausMs: [HORA],
  decaimentoMs: 24 * HORA,
};
export const LIMITE_RECUPERACAO_CONTA: ConfigLimite = {
  limite: 3,
  janelaMs: HORA,
  degrausMs: [HORA],
  decaimentoMs: 24 * HORA,
};
/** Tentativas de redefinir senha com token (contra adivinhação): por IP. */
export const LIMITE_REDEFINICAO_IP: ConfigLimite = {
  limite: 10,
  janelaMs: HORA,
  degrausMs: [HORA],
  decaimentoMs: 24 * HORA,
};

/** Ativação inicial: tentativas de informar o código de inicialização (contra adivinhação), por IP. */
export const LIMITE_ATIVACAO_CODIGO_IP: ConfigLimite = {
  limite: 5, // a tentativa é contada antes de conferir: a 5ª dispara o bloqueio, então são avaliadas 4
  janelaMs: HORA,
  degrausMs: [HORA, 4 * HORA, 24 * HORA],
  decaimentoMs: 48 * HORA,
};
/** Ativação inicial: e-mails de confirmação enviados (cada pedido conta), por IP. */
export const LIMITE_ATIVACAO_ENVIO_IP: ConfigLimite = {
  limite: 4, // o pedido é contado antes de agir: o 4º dispara o bloqueio, então passam 3
  janelaMs: HORA,
  degrausMs: [HORA],
  decaimentoMs: 24 * HORA,
};
/** Ativação inicial: tentativas de confirmar com token inválido, por IP. */
export const LIMITE_ATIVACAO_TOKEN_IP: ConfigLimite = LIMITE_REDEFINICAO_IP;

export function bloqueioRestanteMs(estado: EstadoLimite | null, agora: Date): number {
  if (!estado?.bloqueado_ate) return 0;
  return Math.max(0, estado.bloqueado_ate.getTime() - agora.getTime());
}

export function registrarFalhaEstado(
  estado: EstadoLimite | null,
  agora: Date,
  config: ConfigLimite
): EstadoLimite {
  let falhas = estado?.falhas ?? 0;
  let nivel = estado?.nivel ?? 0;

  if (estado) {
    const ocioso = agora.getTime() - estado.atualizado_em.getTime();
    const bloqueioVigente = bloqueioRestanteMs(estado, agora) > 0;
    if (ocioso > config.decaimentoMs) {
      falhas = 0;
      nivel = 0;
    } else if (ocioso > config.janelaMs && !bloqueioVigente) {
      falhas = 0;
    }
  }

  falhas += 1;

  if (falhas >= config.limite) {
    const degrau = config.degrausMs[Math.min(nivel, config.degrausMs.length - 1)];
    return {
      falhas: 0,
      nivel: nivel + 1,
      bloqueado_ate: new Date(agora.getTime() + degrau),
      atualizado_em: agora,
    };
  }

  return { falhas, nivel, bloqueado_ate: estado?.bloqueado_ate ?? null, atualizado_em: agora };
}

export function formatarEspera(ms: number): string {
  const minutos = Math.ceil(ms / MINUTO);
  if (minutos <= 1) return "1 minuto";
  if (minutos < 60) return `${minutos} minutos`;
  const horas = Math.ceil(minutos / 60);
  return horas === 1 ? "1 hora" : `${horas} horas`;
}
