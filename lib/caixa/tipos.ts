/**
 * Tipos e constantes do controle de caixa. Lógica pura: roda no servidor e no navegador (offline).
 * TODOS os valores financeiros são INTEIROS em centavos — nunca ponto flutuante.
 */

export type FormaCaixa = "dinheiro" | "pix" | "credito" | "debito" | "fiado";
export const FORMAS_CAIXA: readonly FormaCaixa[] = ["dinheiro", "pix", "credito", "debito", "fiado"];
export const ROTULO_FORMA: Record<FormaCaixa, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  credito: "Cartão de crédito",
  debito: "Cartão de débito",
  fiado: "Fiado / conta a receber",
};

export type TipoMovimento =
  | "venda"
  | "recebimento_conta"
  | "suprimento"
  | "outra_entrada"
  | "ajuste_entrada"
  | "sangria"
  | "despesa"
  | "outra_saida"
  | "ajuste_saida"
  | "estorno";

export type Sentido = "entrada" | "saida";
export type OrigemRegistro = "online" | "offline";
export type OrigemOperacao = "pdv" | "conta_receber" | "caixa";

export const ROTULO_TIPO: Record<TipoMovimento, string> = {
  venda: "Venda",
  recebimento_conta: "Recebimento de conta",
  suprimento: "Suprimento",
  outra_entrada: "Outra entrada",
  ajuste_entrada: "Ajuste (entrada)",
  sangria: "Sangria",
  despesa: "Despesa paga pelo caixa",
  outra_saida: "Outra retirada",
  ajuste_saida: "Ajuste (saída)",
  estorno: "Estorno",
};

/** Movimentos avulsos de dinheiro (não vêm de venda): sempre em dinheiro, sempre com motivo. */
export const TIPOS_AVULSOS = [
  "suprimento",
  "outra_entrada",
  "ajuste_entrada",
  "sangria",
  "despesa",
  "outra_saida",
  "ajuste_saida",
] as const satisfies readonly TipoMovimento[];
export type TipoAvulso = (typeof TIPOS_AVULSOS)[number];

export const SENTIDO_DO_TIPO: Record<TipoAvulso, Sentido> = {
  suprimento: "entrada",
  outra_entrada: "entrada",
  ajuste_entrada: "entrada",
  sangria: "saida",
  despesa: "saida",
  outra_saida: "saida",
  ajuste_saida: "saida",
};

export function tipoAvulsoValido(tipo: unknown): tipo is TipoAvulso {
  return typeof tipo === "string" && (TIPOS_AVULSOS as readonly string[]).includes(tipo);
}

/** Limite do banco (Int4) e teto de sanidade por movimento: R$ 9.999.999,99. */
export const MAX_CENTAVOS = 999_999_999;

export interface DadosCartao {
  bandeira?: string | null;
  adquirente?: string | null;
  parcelas?: number | null;
  /** Taxa CONHECIDA em centavos. Nulo/ausente = desconhecida (nunca presumida). */
  taxa_centavos?: number | null;
  transacao_id?: string | null;
}

/** Movimento como o cálculo do resumo o enxerga (servidor e aparelho convertem para este formato). */
export interface MovimentoResumo {
  id: string;
  tipo: TipoMovimento;
  sentido: Sentido;
  forma_pagamento: FormaCaixa;
  valor_centavos: number;
  estorno_de_id?: string | null;
  venda_id?: string | null;
  cartao_taxa_centavos?: number | null;
}

export interface LinhaFormaResumo {
  forma: FormaCaixa;
  /** Entradas (vendas, recebimentos, suprimentos...) nesta forma. */
  entradas_centavos: number;
  /** Saídas (sangria, despesa, estornos...) nesta forma. */
  saidas_centavos: number;
  saldo_centavos: number;
  quantidade: number;
  /** Só vendas/recebimentos de cartão: taxas conhecidas e quantas operações têm taxa desconhecida. */
  taxas_conhecidas_centavos: number;
  operacoes_sem_taxa: number;
  /** Bruto − taxas CONHECIDAS. Não é faturamento nem valor garantido: é uma previsão. */
  liquido_previsto_centavos: number;
}

export interface ResumoCaixa {
  fundo_inicial_centavos: number;
  por_forma: Record<FormaCaixa, LinhaFormaResumo>;
  dinheiro: {
    fundo_inicial_centavos: number;
    entradas_vendas_centavos: number;
    recebimentos_conta_centavos: number;
    suprimentos_centavos: number;
    outras_entradas_centavos: number;
    sangrias_centavos: number;
    despesas_centavos: number;
    outras_saidas_centavos: number;
    estornos_centavos: number;
    saldo_esperado_centavos: number;
  };
  /** Faturamento das vendas (inclui fiado), já descontados os estornos de venda. */
  total_vendas_centavos: number;
  /** Dinheiro/Pix/cartão efetivamente recebidos (vendas + recebimentos de conta), sem fiado, líquido de estornos. */
  total_recebido_centavos: number;
  total_entradas_centavos: number;
  total_saidas_centavos: number;
  quantidade_movimentos: number;
  quantidade_vendas: number;
}

export interface ConferenciaInformada {
  /** Valor contado/informado por forma, em centavos. Ausente = não conferido. */
  dinheiro_centavos?: number | null;
  pix_centavos?: number | null;
  credito_centavos?: number | null;
  debito_centavos?: number | null;
}

export const CHAVE_CONFERENCIA: Record<Exclude<FormaCaixa, "fiado">, keyof ConferenciaInformada> = {
  dinheiro: "dinheiro_centavos",
  pix: "pix_centavos",
  credito: "credito_centavos",
  debito: "debito_centavos",
};

export interface DiferencaForma {
  forma: Exclude<FormaCaixa, "fiado">;
  esperado_centavos: number;
  informado_centavos: number | null;
  diferenca_centavos: number | null;
}

/** Estado exibido ao usuário (derivado: ver `statusExibicao`). */
export type StatusCaixaExibicao =
  | "aberto"
  | "fechamento_pendente_sincronizacao"
  | "aguardando_conferencia"
  | "fechado"
  | "com_divergencia";

export const ROTULO_STATUS: Record<StatusCaixaExibicao, string> = {
  aberto: "Aberto",
  fechamento_pendente_sincronizacao: "Fechamento pendente de sincronização",
  aguardando_conferencia: "Aguardando conferência",
  fechado: "Fechado",
  com_divergencia: "Com divergência",
};

/**
 * Regra de exibição:
 *  - aberto                    → "Aberto"
 *  - fechado só no aparelho    → "Fechamento pendente de sincronização" (NUNCA como confirmado)
 *  - fechado no servidor, diferença ≠ 0, ainda sem revisão do administrador → "Aguardando conferência"
 *  - fechado no servidor, diferença ≠ 0, revisado pelo administrador       → "Com divergência"
 *  - fechado no servidor sem diferença                                      → "Fechado"
 */
export function statusExibicao(c: {
  status: "aberto" | "fechado";
  fechamentoConfirmadoNoServidor: boolean;
  diferenca_total_centavos: number | null;
  conferencia_status: "pendente" | "conferido" | null;
}): StatusCaixaExibicao {
  if (c.status === "aberto") return "aberto";
  if (!c.fechamentoConfirmadoNoServidor) return "fechamento_pendente_sincronizacao";
  if ((c.diferenca_total_centavos ?? 0) === 0) return "fechado";
  return c.conferencia_status === "conferido" ? "com_divergencia" : "aguardando_conferencia";
}
