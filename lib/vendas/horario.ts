import { TOLERANCIA_RELOGIO_MS, formatarDataHora } from "@/lib/utils/fuso";

/**
 * Horário de uma venda.
 *
 *  - `vendas.created_at`  = quando o SERVIDOR recebeu/gravou a venda. Confiável; nunca vem do dispositivo.
 *  - `vendas.ocorrido_em` = quando a venda aconteceu segundo o relógio do dispositivo, já VALIDADO por este módulo.
 *
 * O relógio do dispositivo não é autenticado. Por isso ele só é aceito como horário de ocorrência dentro de limites;
 * fora deles a venda NÃO é gravada nem corrigida para "agora": fica retida para revisão de um administrador
 * (`vendas_revisao`), com o conteúdo original e o horário informado preservados.
 * Lógica pura (sem banco): o serviço fornece o instante de recebimento e a abertura do caixa.
 */

/** Janela máxima entre a ocorrência e a chegada ao servidor. Passou disso, só um administrador libera. */
export const JANELA_OFFLINE_MS = 48 * 60 * 60 * 1000;
/** Quanto o relógio do dispositivo pode estar adiantado em relação ao servidor. */
export const TOLERANCIA_FUTURO_MS = TOLERANCIA_RELOGIO_MS;

export type CodigoHorarioInvalido = "horario_invalido" | "horario_futuro" | "fora_janela_offline" | "anterior_abertura_caixa";

export interface MotivoHorario {
  codigo: CodigoHorarioInvalido;
  mensagem: string;
}

export interface AvaliacaoHorario {
  /** Instante aceito como horário de ocorrência; null = não informado ou não aceito (a venda segue para revisão). */
  ocorrido_em: Date | null;
  motivos: MotivoHorario[];
}

/** Converte o valor recebido num instante; null se ausente ou não for uma data ISO válida. */
export function lerInstante(valor: unknown): Date | null {
  if (typeof valor !== "string" || valor.trim() === "" || valor.length > 40) return null;
  const t = Date.parse(valor);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * Confere o horário informado pelo dispositivo.
 * As mensagens são ESTÁVEIS (não dependem de "agora"): a revisão compara os motivos ao aprovar e uma mensagem que
 * mudasse a cada segundo impediria qualquer aprovação.
 */
export function avaliarHorarioDaVenda(params: { informado: unknown; agora: Date; caixaAbertoEm?: Date | null }): AvaliacaoHorario {
  const { informado, agora, caixaAbertoEm } = params;
  if (informado === undefined || informado === null) return { ocorrido_em: null, motivos: [] };

  const instante = lerInstante(informado);
  if (!instante) {
    return { ocorrido_em: null, motivos: [{ codigo: "horario_invalido", mensagem: "O horário informado pelo aparelho para a venda é inválido." }] };
  }
  const quando = formatarDataHora(instante);
  const motivos: MotivoHorario[] = [];

  if (instante.getTime() > agora.getTime() + TOLERANCIA_FUTURO_MS) {
    motivos.push({
      codigo: "horario_futuro",
      mensagem: `O horário informado pelo aparelho (${quando}) está no futuro: o relógio do aparelho pode estar adiantado.`,
    });
  } else {
    if (instante.getTime() < agora.getTime() - JANELA_OFFLINE_MS) {
      motivos.push({
        codigo: "fora_janela_offline",
        mensagem: `A venda ocorreu em ${quando}, fora da janela de 48 horas de sincronização.`,
      });
    }
    if (caixaAbertoEm && instante.getTime() < caixaAbertoEm.getTime()) {
      motivos.push({
        codigo: "anterior_abertura_caixa",
        mensagem: `O horário informado pelo aparelho (${quando}) é anterior à abertura do caixa desta venda.`,
      });
    }
  }
  // Com qualquer motivo o instante NÃO é aceito aqui; o que foi informado segue preservado no payload retido.
  return { ocorrido_em: motivos.length === 0 ? instante : null, motivos };
}

/**
 * Último filtro na hora de gravar (vale também para quem chama o serviço direto): o horário do dispositivo só é
 * gravado se for uma data válida e não estiver além da tolerância no futuro. Nunca vira "agora" por conveniência:
 * se não serve, fica null (e o relatório usa `created_at`).
 */
export function ocorridoEmParaGravar(valor: unknown, agora: Date = new Date()): Date | null {
  const instante = lerInstante(valor instanceof Date ? valor.toISOString() : valor);
  if (!instante) return null;
  return instante.getTime() > agora.getTime() + TOLERANCIA_FUTURO_MS ? null : instante;
}

/** Horário a EXIBIR e a FILTRAR: o da ocorrência quando houver; vendas antigas (sem ocorrido_em) usam created_at. */
export function horarioDaVenda<T extends { created_at: Date | string; ocorrido_em?: Date | string | null }>(v: T): Date {
  return new Date(v.ocorrido_em ?? v.created_at);
}
