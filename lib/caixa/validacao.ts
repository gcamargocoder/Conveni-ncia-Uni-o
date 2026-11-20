import {
  FORMAS_CAIXA,
  MAX_CENTAVOS,
  SENTIDO_DO_TIPO,
  tipoAvulsoValido,
  type DadosCartao,
  type FormaCaixa,
  type OrigemRegistro,
  type TipoAvulso,
} from "./tipos";

/** Validações de entrada do caixa (servidor e aparelho). Nada vindo do navegador é confiável. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuidOk = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export function centavosOk(v: unknown, opcoes: { permitirZero?: boolean } = {}): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= (opcoes.permitirZero ? 0 : 1) && v <= MAX_CENTAVOS;
}

export const origemOk = (v: unknown): v is OrigemRegistro => v === "online" || v === "offline";
export const formaOk = (v: unknown): v is FormaCaixa => typeof v === "string" && (FORMAS_CAIXA as readonly string[]).includes(v);

export function textoLimpo(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length > 0 ? t : null;
}

export interface PagamentoVenda {
  forma: FormaCaixa;
  valor_centavos: number;
  cartao?: DadosCartao | null;
}

/** Confere a lista de pagamentos de uma venda contra o total em centavos. Devolve mensagens de erro. */
export function validarPagamentosVenda(pagamentos: unknown, totalCentavos: number): string[] {
  const erros: string[] = [];
  if (!Array.isArray(pagamentos) || pagamentos.length === 0) return ["Informe ao menos uma forma de pagamento."];
  if (pagamentos.length > 10) return ["Pagamento dividido em formas demais."];

  let soma = 0;
  pagamentos.forEach((bruto, i) => {
    const p = (bruto ?? {}) as Record<string, unknown>;
    const n = i + 1;
    if (!formaOk(p.forma)) erros.push(`Pagamento ${n}: forma inválida.`);
    if (!centavosOk(p.valor_centavos)) {
      erros.push(`Pagamento ${n}: valor inválido.`);
    } else {
      soma += p.valor_centavos;
    }
    const cartao = p.cartao as DadosCartao | null | undefined;
    if (cartao) {
      if (p.forma !== "credito" && p.forma !== "debito") erros.push(`Pagamento ${n}: dados de cartão só valem para crédito e débito.`);
      if (cartao.parcelas != null && (!Number.isInteger(cartao.parcelas) || cartao.parcelas < 1 || cartao.parcelas > 48)) {
        erros.push(`Pagamento ${n}: número de parcelas inválido.`);
      }
      if (p.forma === "debito" && cartao.parcelas != null && cartao.parcelas !== 1) {
        erros.push(`Pagamento ${n}: débito não é parcelado.`);
      }
      if (cartao.taxa_centavos != null) {
        if (!centavosOk(cartao.taxa_centavos, { permitirZero: true })) erros.push(`Pagamento ${n}: taxa inválida.`);
        else if (centavosOk(p.valor_centavos) && cartao.taxa_centavos > p.valor_centavos) erros.push(`Pagamento ${n}: taxa maior que o valor.`);
      }
    }
  });

  if (erros.length === 0 && soma !== totalCentavos) {
    erros.push("A soma das formas de pagamento não confere com o total da venda.");
  }
  return erros;
}

export interface MovimentoAvulsoEntrada {
  id: string;
  caixa_id: string;
  tipo: TipoAvulso;
  valor_centavos: number;
  descricao?: string | null;
  justificativa?: string | null;
  ocorrido_em: string;
}

/** Sangria, suprimento, despesa e demais movimentos avulsos: valor, motivo e responsável (o PIN vem à parte). */
export function validarMovimentoAvulso(entrada: unknown): string[] {
  const e = (entrada ?? {}) as Record<string, unknown>;
  const erros: string[] = [];
  if (!uuidOk(e.id)) erros.push("Identificador da operação inválido.");
  if (!uuidOk(e.caixa_id)) erros.push("Caixa inválido.");
  if (!tipoAvulsoValido(e.tipo)) erros.push("Tipo de movimentação inválido.");
  if (!centavosOk(e.valor_centavos)) erros.push("Informe um valor maior que zero.");
  if (!textoLimpo(e.justificativa, 300)) erros.push("Informe o motivo da movimentação.");
  if (typeof e.ocorrido_em !== "string" || Number.isNaN(Date.parse(e.ocorrido_em))) erros.push("Data da operação inválida.");
  return erros;
}

export function sentidoDoAvulso(tipo: TipoAvulso) {
  return SENTIDO_DO_TIPO[tipo];
}

export const MAX_TEXTO = { descricao: 200, justificativa: 300, observacao: 300 } as const;
