import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma/client";
import { possuiPermissao, type Permissao } from "@/lib/auth/permissoes";
import type { Cargo } from "@/types/funcionario";
import { calcularDiferencas, haDivergencia, resumirCaixa } from "@/lib/caixa/calculo";
import {
  SENTIDO_DO_TIPO,
  tipoAvulsoValido,
  type ConferenciaInformada,
  type DadosCartao,
  type FormaCaixa,
  type MovimentoResumo,
  type OrigemOperacao,
  type OrigemRegistro,
  type ResumoCaixa,
  type TipoAvulso,
  type TipoMovimento,
} from "@/lib/caixa/tipos";
import {
  MAX_TEXTO,
  centavosOk,
  formaOk,
  origemOk,
  textoLimpo,
  uuidOk,
  validarMovimentoAvulso,
  type PagamentoVenda,
} from "@/lib/caixa/validacao";

/**
 * Serviço de caixa (servidor). Regras centrais:
 *  - valores em centavos inteiros; nada vindo do navegador é confiável;
 *  - toda escrita financeira roda em transação e trava a linha do caixa (FOR UPDATE), o que
 *    serializa vendas, sangrias e o fechamento do mesmo caixa;
 *  - os ids vêm do aparelho (UUID): repetir uma operação NUNCA duplica nada;
 *  - o funcionário (identificado pelo PIN) é REVALIDADO aqui: existe, está ativo e tem permissão.
 *    O servidor não consegue provar qual PIN foi digitado numa operação offline.
 */

type Cliente = Prisma.TransactionClient;

export class CaixaError extends Error {
  constructor(
    public readonly codigo:
      | "caixa_inexistente"
      | "caixa_fechado"
      | "caixa_outro_terminal"
      | "funcionario_invalido"
      | "dados_invalidos"
      | "terminal_ocupado"
      | "ja_estornado"
      | "nao_estornavel"
      | "sem_autorizacao",
    mensagem: string
  ) {
    super(mensagem);
    this.name = "CaixaError";
  }
}

export interface Autoria {
  /** Funcionário identificado pelo PIN. */
  funcionario_id: string;
  /** Usuário administrativo autenticado (sessão), quando houver. */
  usuario_id: string | null;
  dispositivo: string;
  origem: OrigemRegistro;
}

export type ResultadoOperacao =
  | { status: "ok"; jaExistia: boolean; detalhe?: unknown }
  | { status: "aguardando"; motivo: string } // depende de outra operação ainda não sincronizada: tentar de novo
  | { status: "conflito"; motivo: string } // registrado para tratamento explícito; nunca descartado
  | { status: "rejeitado"; erro: string }; // dados inválidos: não adianta reenviar

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Relógio do terminal, mas nunca no futuro (tolerância de 5 min) e nunca inválido. */
export function instanteDoTerminal(valor: unknown, agora = new Date()): Date {
  const t = typeof valor === "string" ? Date.parse(valor) : NaN;
  if (Number.isNaN(t) || t > agora.getTime() + 5 * 60_000) return agora;
  return new Date(t);
}

/** UUID determinístico (v5-like) a partir de uma semente: idempotência de estornos derivados de uma operação. */
export function uuidDerivado(semente: string): string {
  const h = createHash("sha1").update(semente).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function validarFuncionario(
  cliente: Pick<Cliente, "funcionario">,
  funcionarioId: string,
  permissao: Permissao
): Promise<{ id: string; nome: string; cargo: Cargo }> {
  if (!uuidOk(funcionarioId)) throw new CaixaError("funcionario_invalido", "Funcionário inválido.");
  const f = await cliente.funcionario.findUnique({
    where: { id: funcionarioId },
    select: { id: true, nome: true, cargo: true, ativo: true, deleted_at: true },
  });
  if (!f) throw new CaixaError("funcionario_invalido", "O funcionário informado não existe.");
  if (!f.ativo || f.deleted_at) throw new CaixaError("funcionario_invalido", "O funcionário informado está inativo ou foi removido.");
  if (!possuiPermissao(f.cargo as Cargo, permissao)) {
    throw new CaixaError("funcionario_invalido", "O cargo do funcionário não tem permissão para esta operação.");
  }
  return { id: f.id, nome: f.nome, cargo: f.cargo as Cargo };
}

interface CaixaTravado {
  id: string;
  status: "aberto" | "fechado";
  terminal_id: string;
  fundo_inicial_centavos: number;
}

async function travarCaixa(tx: Cliente, id: string): Promise<CaixaTravado | null> {
  const linhas = await tx.$queryRaw<CaixaTravado[]>`
    SELECT id::text AS id, status, terminal_id, fundo_inicial_centavos FROM caixas WHERE id = ${id}::uuid FOR UPDATE`;
  return linhas[0] ?? null;
}

/** Trava o caixa e exige que esteja aberto e pertença ao terminal informado. */
async function exigirCaixaAberto(tx: Cliente, caixaId: string, dispositivo: string): Promise<CaixaTravado> {
  const caixa = uuidOk(caixaId) ? await travarCaixa(tx, caixaId) : null;
  if (!caixa) throw new CaixaError("caixa_inexistente", "Caixa não encontrado.");
  if (caixa.status !== "aberto") throw new CaixaError("caixa_fechado", "O caixa já está fechado: movimentação recusada.");
  if (caixa.terminal_id !== dispositivo) {
    throw new CaixaError("caixa_outro_terminal", "O caixa pertence a outro terminal.");
  }
  return caixa;
}

async function auditar(
  tx: Cliente,
  caixaId: string,
  acao: string,
  autoria: Partial<Autoria>,
  detalhes?: Record<string, unknown>
): Promise<void> {
  await tx.auditoriaCaixa.create({
    data: {
      caixa_id: caixaId,
      acao,
      funcionario_id: autoria.funcionario_id ?? null,
      usuario_id: autoria.usuario_id ?? null,
      dispositivo: autoria.dispositivo ?? null,
      origem: autoria.origem ?? null,
      detalhes: (detalhes ?? {}) as Prisma.InputJsonValue,
    },
  });
}

function paraResumo(m: {
  id: string;
  tipo: string;
  sentido: string;
  forma_pagamento: string;
  valor_centavos: number;
  estorno_de_id: string | null;
  venda_id: string | null;
  cartao_taxa_centavos: number | null;
}): MovimentoResumo {
  return {
    id: m.id,
    tipo: m.tipo as TipoMovimento,
    sentido: m.sentido as MovimentoResumo["sentido"],
    forma_pagamento: m.forma_pagamento as FormaCaixa,
    valor_centavos: m.valor_centavos,
    estorno_de_id: m.estorno_de_id,
    venda_id: m.venda_id,
    cartao_taxa_centavos: m.cartao_taxa_centavos,
  };
}

const SELECT_RESUMO = {
  id: true,
  tipo: true,
  sentido: true,
  forma_pagamento: true,
  valor_centavos: true,
  estorno_de_id: true,
  venda_id: true,
  cartao_taxa_centavos: true,
} as const;

export async function resumoDoCaixa(caixaId: string, cliente: Pick<Cliente, "caixa" | "movimentoCaixa"> = prisma): Promise<ResumoCaixa | null> {
  const caixa = await cliente.caixa.findUnique({ where: { id: caixaId }, select: { fundo_inicial_centavos: true } });
  if (!caixa) return null;
  const movs = await cliente.movimentoCaixa.findMany({ where: { caixa_id: caixaId }, select: SELECT_RESUMO });
  return resumirCaixa(caixa.fundo_inicial_centavos, movs.map(paraResumo));
}

// ---------------------------------------------------------------------------
// Abertura
// ---------------------------------------------------------------------------

export interface EntradaAbertura {
  id: string;
  terminal_id: string;
  terminal_papel?: string | null;
  fundo_inicial_centavos: number;
  observacoes?: string | null;
  aberto_em: string;
}

export async function abrirCaixa(entrada: EntradaAbertura, autoria: Autoria): Promise<ResultadoOperacao> {
  if (!uuidOk(entrada.id) || !textoLimpo(entrada.terminal_id, 80) || !centavosOk(entrada.fundo_inicial_centavos, { permitirZero: true })) {
    return { status: "rejeitado", erro: "Dados da abertura de caixa inválidos." };
  }
  if (autoria.dispositivo !== entrada.terminal_id) {
    return { status: "rejeitado", erro: "O terminal da abertura não confere com o dispositivo." };
  }

  const jaExiste = await prisma.caixa.findUnique({ where: { id: entrada.id }, select: { id: true } });
  if (jaExiste) return { status: "ok", jaExistia: true };

  try {
    await prisma.$transaction(async (tx) => {
      await validarFuncionario(tx, autoria.funcionario_id, "pdv.vender");
      const aberto = await tx.caixa.findFirst({ where: { terminal_id: entrada.terminal_id, status: "aberto" }, select: { id: true } });
      if (aberto) throw new CaixaError("terminal_ocupado", "Este terminal já tem um caixa aberto.");
      await tx.caixa.create({
        data: {
          id: entrada.id,
          terminal_id: entrada.terminal_id,
          terminal_papel: textoLimpo(entrada.terminal_papel, 20),
          fundo_inicial_centavos: entrada.fundo_inicial_centavos,
          observacoes_abertura: textoLimpo(entrada.observacoes, MAX_TEXTO.observacao),
          aberto_em: instanteDoTerminal(entrada.aberto_em),
          aberto_por_funcionario_id: autoria.funcionario_id,
          aberto_por_usuario_id: autoria.usuario_id,
          origem_abertura: autoria.origem,
        },
      });
      await auditar(tx, entrada.id, "abertura", autoria, { fundo_inicial_centavos: entrada.fundo_inicial_centavos });
    });
    return { status: "ok", jaExistia: false };
  } catch (e) {
    if (e instanceof CaixaError) {
      return e.codigo === "terminal_ocupado" ? { status: "conflito", motivo: e.message } : { status: "rejeitado", erro: e.message };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Corrida: outra abertura do mesmo terminal (ou a mesma operação) venceu.
      const mesma = await prisma.caixa.findUnique({ where: { id: entrada.id }, select: { id: true } });
      if (mesma) return { status: "ok", jaExistia: true };
      return { status: "conflito", motivo: "Este terminal já tem um caixa aberto." };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Vendas (chamado de dentro da transação da venda)
// ---------------------------------------------------------------------------

export interface VendaParaCaixa {
  venda_id: string;
  caixa_id: string;
  pagamentos: PagamentoVenda[];
  ocorrido_em: string | Date;
}

/**
 * Lança um movimento por forma de pagamento (pagamento dividido gera lançamentos separados).
 * Idempotente: (venda_id, tipo, ordem) é único — a segunda chamada não cria nada.
 * Fiado vira lançamento "fiado" (faturamento, mas NÃO dinheiro recebido).
 */
export async function lancarVendaNoCaixa(tx: Cliente, venda: VendaParaCaixa, autoria: Autoria): Promise<void> {
  await exigirCaixaAberto(tx, venda.caixa_id, autoria.dispositivo);
  const quando = venda.ocorrido_em instanceof Date ? venda.ocorrido_em : instanteDoTerminal(venda.ocorrido_em);

  const existentes = await tx.movimentoCaixa.count({ where: { venda_id: venda.venda_id, tipo: "venda" } });
  if (existentes > 0) return;

  let ordem = 0;
  for (const p of venda.pagamentos) {
    const cartao = p.cartao ?? null;
    await tx.movimentoCaixa.create({
      data: {
        id: uuidDerivado(`venda:${venda.venda_id}:${ordem}`),
        caixa_id: venda.caixa_id,
        tipo: "venda",
        sentido: "entrada",
        forma_pagamento: p.forma,
        valor_centavos: p.valor_centavos,
        funcionario_id: autoria.funcionario_id,
        usuario_id: autoria.usuario_id,
        dispositivo: autoria.dispositivo,
        origem: autoria.origem,
        origem_operacao: "pdv",
        venda_id: venda.venda_id,
        ordem,
        descricao: "Venda no PDV",
        cartao_bandeira: textoLimpo(cartao?.bandeira, 40),
        cartao_adquirente: textoLimpo(cartao?.adquirente, 60),
        cartao_parcelas: cartao?.parcelas ?? null,
        cartao_taxa_centavos: cartao?.taxa_centavos ?? null,
        transacao_id: textoLimpo(cartao?.transacao_id, 80),
        ocorrido_em: quando,
      },
    });
    ordem++;
  }
}

// ---------------------------------------------------------------------------
// Recebimento de conta a receber (chamado de dentro da transação do pagamento)
// ---------------------------------------------------------------------------

export interface RecebimentoParaCaixa {
  recebimento_id: string;
  terminal_id: string;
  valor_centavos: number;
  forma: FormaCaixa;
  funcionario_id: string;
  usuario_id: string | null;
  descricao: string;
}

/**
 * O recebimento de uma conta (fiado) só entra no caixa quando REALMENTE recebido, e só se houver
 * caixa aberto no terminal informado. Devolve false (sem lançar) quando não há caixa aberto.
 */
export async function lancarRecebimentoNoCaixa(tx: Cliente, r: RecebimentoParaCaixa): Promise<boolean> {
  if (r.forma === "fiado") return false;
  const caixa = await tx.caixa.findFirst({ where: { terminal_id: r.terminal_id, status: "aberto" }, select: { id: true } });
  if (!caixa) return false;
  const travado = await travarCaixa(tx, caixa.id);
  if (!travado || travado.status !== "aberto") return false;
  await tx.movimentoCaixa.create({
    data: {
      id: uuidDerivado(`recebimento:${r.recebimento_id}`),
      caixa_id: caixa.id,
      tipo: "recebimento_conta",
      sentido: "entrada",
      forma_pagamento: r.forma,
      valor_centavos: r.valor_centavos,
      funcionario_id: r.funcionario_id,
      usuario_id: r.usuario_id,
      dispositivo: r.terminal_id,
      origem: "online",
      origem_operacao: "conta_receber",
      recebimento_id: r.recebimento_id,
      descricao: r.descricao.slice(0, MAX_TEXTO.descricao),
      ocorrido_em: new Date(),
    },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Movimentos avulsos: suprimento, sangria, despesa, ajustes
// ---------------------------------------------------------------------------

export interface EntradaMovimentoAvulso {
  id: string;
  caixa_id: string;
  tipo: TipoAvulso;
  valor_centavos: number;
  descricao?: string | null;
  justificativa: string;
  ocorrido_em: string;
}

export async function registrarMovimentoAvulso(entrada: EntradaMovimentoAvulso, autoria: Autoria): Promise<ResultadoOperacao> {
  if (!uuidOk(entrada.id) || !uuidOk(entrada.caixa_id)) return { status: "rejeitado", erro: "Operação de caixa inválida." };
  const erros = validarMovimentoAvulso(entrada);
  if (erros.length > 0) return { status: "rejeitado", erro: erros[0] };

  const existente = await prisma.movimentoCaixa.findUnique({ where: { id: entrada.id }, select: { id: true, caixa_id: true } });
  if (existente) return { status: "ok", jaExistia: true };

  const caixaExiste = await prisma.caixa.findUnique({ where: { id: entrada.caixa_id }, select: { id: true } });
  if (!caixaExiste) return { status: "aguardando", motivo: "O caixa ainda não foi sincronizado." };

  try {
    await prisma.$transaction(async (tx) => {
      await validarFuncionario(tx, autoria.funcionario_id, "caixa.movimentar");
      await exigirCaixaAberto(tx, entrada.caixa_id, autoria.dispositivo);
      // Com o caixa travado: se outra requisição da MESMA operação venceu a corrida, não há o que fazer nem o que consumir.
      if ((await tx.movimentoCaixa.count({ where: { id: entrada.id } })) > 0) throw new JaAplicada();
      await consumirAutorizacao(
        tx,
        { kind: "movimento", operacao_id: entrada.id, caixa_id: entrada.caixa_id, tipo: entrada.tipo, valor_centavos: entrada.valor_centavos },
        autoria
      );
      await tx.movimentoCaixa.create({
        data: {
          id: entrada.id,
          caixa_id: entrada.caixa_id,
          tipo: entrada.tipo,
          sentido: SENTIDO_DO_TIPO[entrada.tipo],
          forma_pagamento: "dinheiro",
          valor_centavos: entrada.valor_centavos,
          funcionario_id: autoria.funcionario_id,
          usuario_id: autoria.usuario_id,
          dispositivo: autoria.dispositivo,
          origem: autoria.origem,
          origem_operacao: "caixa",
          descricao: textoLimpo(entrada.descricao, MAX_TEXTO.descricao),
          justificativa: textoLimpo(entrada.justificativa, MAX_TEXTO.justificativa),
          ocorrido_em: instanteDoTerminal(entrada.ocorrido_em),
        },
      });
    });
    return { status: "ok", jaExistia: false };
  } catch (e) {
    if (e instanceof JaAplicada) return { status: "ok", jaExistia: true };
    return tratarErroOperacao(e, entrada.id);
  }
}

// ---------------------------------------------------------------------------
// Estorno / cancelamento (correção = novo registro; o original nunca é alterado)
// ---------------------------------------------------------------------------

export interface EntradaEstorno {
  /** Id da operação (idempotência). */
  id: string;
  /** Caixa ABERTO onde o estorno é lançado (o dinheiro sai do caixa de hoje). */
  caixa_id: string;
  venda_id?: string | null;
  movimento_id?: string | null;
  justificativa: string;
  ocorrido_em: string;
}

/**
 * O estorno por `movimento_id` (avulso) só vale para lançamentos que nascem no próprio caixa (suprimento, sangria,
 * despesa, ajustes). Lançamentos de VENDA têm de passar pelo cancelamento da venda (`venda_id`: estorna todas as formas,
 * marca a venda como cancelada, recusa parte fiado) e os de RECEBIMENTO de conta a receber pelo tratamento da própria
 * conta: o estorno avulso deles deixaria o caixa em desacordo com a venda, a conta a receber e o estoque.
 * Vale no servidor, independentemente do que a tela mostra ou do que o aparelho enviou.
 */
async function recusarEstornoAvulsoFinanceiro(tx: Cliente, movimentoId: string): Promise<void> {
  const mov = await tx.movimentoCaixa.findUnique({
    where: { id: movimentoId },
    select: { tipo: true, venda_id: true, recebimento_id: true },
  });
  if (!mov) return; // "não encontrado" é tratado adiante, com a mesma mensagem de sempre
  if (mov.tipo === "venda" || mov.venda_id) {
    throw new CaixaError("nao_estornavel", "Lançamento de venda não pode ser estornado avulso: cancele a venda pelo fluxo de cancelamento.");
  }
  if (mov.tipo === "recebimento_conta" || mov.recebimento_id) {
    throw new CaixaError("nao_estornavel", "Recebimento de conta a receber não pode ser estornado avulso: trate-o na própria conta a receber.");
  }
  if (mov.tipo !== "estorno" && !tipoAvulsoValido(mov.tipo)) {
    throw new CaixaError("nao_estornavel", "Este tipo de lançamento não pode ser estornado avulso.");
  }
}

export async function estornar(entrada: EntradaEstorno, autoria: Autoria): Promise<ResultadoOperacao> {
  if (!uuidOk(entrada.id) || !uuidOk(entrada.caixa_id) || !textoLimpo(entrada.justificativa, MAX_TEXTO.justificativa)) {
    return { status: "rejeitado", erro: "Informe o motivo do estorno." };
  }
  if (!!entrada.venda_id === !!entrada.movimento_id || (entrada.venda_id && !uuidOk(entrada.venda_id)) || (entrada.movimento_id && !uuidOk(entrada.movimento_id))) {
    return { status: "rejeitado", erro: "Informe a venda OU o movimento a estornar." };
  }

  const jaFeito = await prisma.auditoriaCaixa.findFirst({
    where: { caixa_id: entrada.caixa_id, acao: "estorno", detalhes: { path: ["operacao_id"], equals: entrada.id } },
    select: { id: true },
  });
  if (jaFeito) return { status: "ok", jaExistia: true };

  const caixaExiste = await prisma.caixa.findUnique({ where: { id: entrada.caixa_id }, select: { id: true } });
  if (!caixaExiste) return { status: "aguardando", motivo: "O caixa ainda não foi sincronizado." };

  try {
    await prisma.$transaction(async (tx) => {
      const ehVenda = Boolean(entrada.venda_id);
      await validarFuncionario(tx, autoria.funcionario_id, ehVenda ? "pdv.cancelar_venda" : "caixa.movimentar");
      await exigirCaixaAberto(tx, entrada.caixa_id, autoria.dispositivo);
      const repetida = await tx.auditoriaCaixa.count({
        where: { caixa_id: entrada.caixa_id, acao: "estorno", detalhes: { path: ["operacao_id"], equals: entrada.id } },
      });
      if (repetida > 0) throw new JaAplicada();
      // Recusa ANTES de consumir a autorização (e, de todo modo, a transação inteira é desfeita ao lançar): um estorno
      // avulso de lançamento de venda ou de recebimento de conta deixaria venda, estoque e recebível dessincronizados do caixa.
      if (!ehVenda) await recusarEstornoAvulsoFinanceiro(tx, entrada.movimento_id!);
      await consumirAutorizacao(
        tx,
        { kind: "estorno", operacao_id: entrada.id, caixa_id: entrada.caixa_id, venda_id: entrada.venda_id, movimento_id: entrada.movimento_id },
        autoria
      );

      const originais = await tx.movimentoCaixa.findMany({
        where: ehVenda ? { venda_id: entrada.venda_id!, tipo: "venda" } : { id: entrada.movimento_id! },
        orderBy: { ordem: "asc" },
      });
      if (originais.length === 0) {
        throw new CaixaError("nao_estornavel", ehVenda ? "A venda não tem lançamentos no caixa." : "Movimento não encontrado.");
      }
      if (originais.some((o) => o.tipo === "estorno")) throw new CaixaError("nao_estornavel", "Um estorno não pode ser estornado.");
      // O estorno só corrige o caixa em que o lançamento foi feito (o mesmo turno). Lançamento de outro caixa — já fechado e
      // conferido — não é alterado por estorno em outro caixa: reabra aquele caixa (permissão e justificativa) e estorne nele.
      if (originais.some((o) => o.caixa_id !== entrada.caixa_id)) {
        throw new CaixaError("nao_estornavel", "O lançamento pertence a outro caixa. Reabra aquele caixa (com PIN de gerente e justificativa) para estornar.");
      }
      if (originais.some((o) => o.forma_pagamento === "fiado")) {
        throw new CaixaError("nao_estornavel", "Vendas com parte em fiado não podem ser estornadas pelo caixa (tratar na conta a receber).");
      }

      const jaEstornados = await tx.movimentoCaixa.count({ where: { estorno_de_id: { in: originais.map((o) => o.id) } } });
      if (jaEstornados > 0) throw new CaixaError("ja_estornado", "Este lançamento já foi estornado.");

      for (const o of originais) {
        await tx.movimentoCaixa.create({
          data: {
            id: uuidDerivado(`estorno:${entrada.id}:${o.id}`),
            caixa_id: entrada.caixa_id,
            tipo: "estorno",
            sentido: o.sentido === "entrada" ? "saida" : "entrada",
            forma_pagamento: o.forma_pagamento,
            valor_centavos: o.valor_centavos,
            funcionario_id: autoria.funcionario_id,
            usuario_id: autoria.usuario_id,
            dispositivo: autoria.dispositivo,
            origem: autoria.origem,
            origem_operacao: "caixa",
            venda_id: null,
            estorno_de_id: o.id,
            descricao: ehVenda ? "Cancelamento de venda" : "Estorno de movimentação",
            justificativa: textoLimpo(entrada.justificativa, MAX_TEXTO.justificativa),
            ocorrido_em: instanteDoTerminal(entrada.ocorrido_em),
          },
        });
      }
      if (ehVenda) await tx.venda.update({ where: { id: entrada.venda_id! }, data: { cancelada: true } });
      await auditar(tx, entrada.caixa_id, "estorno", autoria, {
        operacao_id: entrada.id,
        venda_id: entrada.venda_id ?? null,
        movimentos: originais.map((o) => o.id),
        justificativa: entrada.justificativa,
      });
    });
    return { status: "ok", jaExistia: false };
  } catch (e) {
    if (e instanceof JaAplicada) return { status: "ok", jaExistia: true };
    return tratarErroOperacao(e, entrada.id);
  }
}

// ---------------------------------------------------------------------------
// Fechamento
// ---------------------------------------------------------------------------

export interface EntradaFechamento {
  caixa_id: string;
  fechado_em: string;
  conferencia: ConferenciaInformada;
  justificativa?: string | null;
  /** Resumo calculado no aparelho (só para comparação/auditoria; o oficial é recalculado aqui). */
  resumo_terminal?: unknown;
  /** true nas chamadas diretas (online): divergência sem justificativa é recusada. Na sincronização, tolera. */
  exigirJustificativa?: boolean;
}

function conferenciaSegura(c: unknown): ConferenciaInformada {
  const o = (c ?? {}) as Record<string, unknown>;
  const pegar = (k: string) => (centavosOk(o[k], { permitirZero: true }) ? (o[k] as number) : null);
  return {
    dinheiro_centavos: pegar("dinheiro_centavos"),
    pix_centavos: pegar("pix_centavos"),
    credito_centavos: pegar("credito_centavos"),
    debito_centavos: pegar("debito_centavos"),
  };
}

export async function fecharCaixa(entrada: EntradaFechamento, autoria: Autoria): Promise<ResultadoOperacao> {
  if (!uuidOk(entrada.caixa_id)) return { status: "rejeitado", erro: "Caixa inválido." };
  const existente = await prisma.caixa.findUnique({ where: { id: entrada.caixa_id }, select: { status: true, terminal_id: true } });
  if (!existente) return { status: "aguardando", motivo: "O caixa ainda não foi sincronizado." };
  if (existente.status === "fechado") return { status: "ok", jaExistia: true };

  const conferencia = conferenciaSegura(entrada.conferencia);
  if (conferencia.dinheiro_centavos == null) {
    return { status: "rejeitado", erro: "Informe o valor contado em dinheiro para fechar o caixa." };
  }

  try {
    const detalhe = await prisma.$transaction(async (tx) => {
      await validarFuncionario(tx, autoria.funcionario_id, "pdv.vender");
      const caixa = await exigirCaixaAberto(tx, entrada.caixa_id, autoria.dispositivo);
      const movs = await tx.movimentoCaixa.findMany({ where: { caixa_id: caixa.id }, select: SELECT_RESUMO });
      const resumo = resumirCaixa(caixa.fundo_inicial_centavos, movs.map(paraResumo));
      const dif = calcularDiferencas(resumo, conferencia);
      const justificativa = textoLimpo(entrada.justificativa, MAX_TEXTO.justificativa);
      if (haDivergencia(dif) && !justificativa && entrada.exigirJustificativa) {
        throw new CaixaError("dados_invalidos", "Há diferença na conferência: informe a justificativa.");
      }
      const divergente = haDivergencia(dif);

      await tx.caixa.update({
        where: { id: caixa.id },
        data: {
          status: "fechado",
          fechado_em: instanteDoTerminal(entrada.fechado_em),
          fechado_por_funcionario_id: autoria.funcionario_id,
          fechado_por_usuario_id: autoria.usuario_id,
          origem_fechamento: autoria.origem,
          conferencia: conferencia as Prisma.InputJsonValue,
          resumo_terminal: (entrada.resumo_terminal ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          resumo_fechamento: { resumo, diferencas: dif.por_forma } as unknown as Prisma.InputJsonValue,
          diferenca_dinheiro_centavos: dif.diferenca_dinheiro_centavos,
          diferenca_total_centavos: dif.diferenca_total_centavos,
          justificativa_divergencia: justificativa,
          conferencia_status: divergente ? "pendente" : null,
        },
      });
      const saldoTerminal = (entrada.resumo_terminal as { dinheiro?: { saldo_esperado_centavos?: number } } | undefined)?.dinheiro
        ?.saldo_esperado_centavos;
      await auditar(tx, caixa.id, "fechamento", autoria, {
        saldo_esperado_dinheiro_centavos: resumo.dinheiro.saldo_esperado_centavos,
        diferenca_total_centavos: dif.diferenca_total_centavos,
        divergente,
        resumo_terminal_difere:
          typeof saldoTerminal === "number" ? saldoTerminal !== resumo.dinheiro.saldo_esperado_centavos : null,
      });
      // Contrato com o aparelho (e com o JSON persistido em resumo_fechamento): diferencas é a LISTA por forma.
      return { resumo, diferencas: dif.por_forma };
    });
    return { status: "ok", jaExistia: false, detalhe };
  } catch (e) {
    return tratarErroOperacao(e, entrada.caixa_id);
  }
}

// ---------------------------------------------------------------------------
// Reabertura excepcional e conferência pelo administrador
// ---------------------------------------------------------------------------

export async function reabrirCaixa(
  entrada: { caixa_id: string; justificativa: string },
  autoria: Autoria
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const justificativa = textoLimpo(entrada.justificativa, MAX_TEXTO.justificativa);
  if (!justificativa || justificativa.length < 10) return { ok: false, erro: "Informe a justificativa da reabertura (mínimo de 10 caracteres)." };
  try {
    await prisma.$transaction(async (tx) => {
      await validarFuncionario(tx, autoria.funcionario_id, "caixa.reabrir");
      const caixa = uuidOk(entrada.caixa_id) ? await travarCaixa(tx, entrada.caixa_id) : null;
      if (!caixa) throw new CaixaError("caixa_inexistente", "Caixa não encontrado.");
      if (caixa.status !== "fechado") throw new CaixaError("dados_invalidos", "O caixa já está aberto.");
      const outro = await tx.caixa.findFirst({ where: { terminal_id: caixa.terminal_id, status: "aberto" }, select: { id: true } });
      if (outro) throw new CaixaError("terminal_ocupado", "O terminal já tem outro caixa aberto.");
      const anterior = await tx.caixa.findUniqueOrThrow({ where: { id: caixa.id } });
      await auditar(tx, caixa.id, "reabertura", autoria, {
        justificativa,
        fechamento_anterior: {
          fechado_em: anterior.fechado_em,
          fechado_por_funcionario_id: anterior.fechado_por_funcionario_id,
          fechado_por_usuario_id: anterior.fechado_por_usuario_id,
          conferencia: anterior.conferencia,
          resumo_fechamento: anterior.resumo_fechamento,
          diferenca_total_centavos: anterior.diferenca_total_centavos,
          justificativa_divergencia: anterior.justificativa_divergencia,
        },
      });
      await tx.caixa.update({
        where: { id: caixa.id },
        data: {
          status: "aberto",
          reaberturas: { increment: 1 },
          fechado_em: null,
          fechado_por_funcionario_id: null,
          fechado_por_usuario_id: null,
          origem_fechamento: null,
          conferencia: Prisma.JsonNull,
          resumo_terminal: Prisma.JsonNull,
          resumo_fechamento: Prisma.JsonNull,
          diferenca_dinheiro_centavos: null,
          diferenca_total_centavos: null,
          justificativa_divergencia: null,
          conferencia_status: null,
          conferido_por_usuario_id: null,
          conferido_em: null,
          conferencia_obs: null,
        },
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof CaixaError) return { ok: false, erro: e.message };
    throw e;
  }
}

export async function conferirCaixa(
  entrada: { caixa_id: string; observacao: string },
  autoria: { usuario_id: string; funcionario_id?: string | null }
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const observacao = textoLimpo(entrada.observacao, MAX_TEXTO.observacao);
  if (!observacao) return { ok: false, erro: "Registre a observação da conferência." };
  const r = await prisma.caixa.updateMany({
    where: { id: entrada.caixa_id, status: "fechado", conferencia_status: "pendente" },
    data: { conferencia_status: "conferido", conferido_por_usuario_id: autoria.usuario_id, conferido_em: new Date(), conferencia_obs: observacao },
  });
  if (r.count !== 1) return { ok: false, erro: "Caixa não encontrado ou sem conferência pendente." };
  await prisma.auditoriaCaixa.create({
    data: { caixa_id: entrada.caixa_id, acao: "conferencia", usuario_id: autoria.usuario_id, funcionario_id: autoria.funcionario_id ?? null, detalhes: { observacao } },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Autorização por PIN (no servidor) das operações administrativas
// ---------------------------------------------------------------------------

export type EscopoAutorizacao =
  | { kind: "movimento"; operacao_id: string; caixa_id: string; tipo: TipoAvulso; valor_centavos: number }
  | { kind: "estorno"; operacao_id: string; caixa_id: string; venda_id?: string | null; movimento_id?: string | null };

/**
 * Validade curta. A autorização é emitida ONLINE no momento em que o PIN é confirmado e a sincronização acontece
 * logo em seguida; as 12 horas cobrem um turno inteiro com a rede instável. Passado o prazo a operação NÃO é
 * aplicada: vira conflito preservado para o administrador tratar (nada se perde, nada é aplicado sem prova recente).
 */
export const VALIDADE_AUTORIZACAO_MS = 12 * 60 * 60 * 1000;

/** Sinaliza, dentro da transação, que a mesma operação já foi aplicada por outra requisição (idempotência). */
class JaAplicada extends Error {}

export function permissaoDoEscopo(e: EscopoAutorizacao): Permissao {
  return e.kind === "estorno" && e.venda_id ? "pdv.cancelar_venda" : "caixa.movimentar";
}

/** Forma canônica do que foi autorizado: tipo, valor e alvo. Mudar qualquer um invalida a autorização. */
export function escopoCanonico(e: EscopoAutorizacao): string {
  return e.kind === "movimento"
    ? JSON.stringify(["movimento", e.caixa_id, e.tipo, e.valor_centavos])
    : JSON.stringify(["estorno", e.caixa_id, e.venda_id ?? "", e.movimento_id ?? ""]);
}

/** Valida o escopo recebido do cliente (nada dele é confiável) e o estado atual do caixa no servidor. */
export async function validarEscopoAutorizacao(e: EscopoAutorizacao): Promise<string | null> {
  if (!e || !uuidOk(e.operacao_id) || !uuidOk(e.caixa_id)) return "Operação inválida.";
  if (e.kind === "movimento") {
    const erros = validarMovimentoAvulso({
      id: e.operacao_id,
      caixa_id: e.caixa_id,
      tipo: e.tipo,
      valor_centavos: e.valor_centavos,
      justificativa: "autorização",
      ocorrido_em: new Date().toISOString(),
    });
    if (erros.length > 0) return erros[0];
  } else if (e.kind === "estorno") {
    const venda = e.venda_id ?? null;
    const mov = e.movimento_id ?? null;
    if (!!venda === !!mov || (venda && !uuidOk(venda)) || (mov && !uuidOk(mov))) return "Informe a venda OU o movimento a estornar.";
  } else {
    return "Operação inválida.";
  }
  // Se o caixa já existe no servidor, só autoriza enquanto estiver aberto (se ainda não sincronizou, a abertura vem antes na fila).
  const caixa = await prisma.caixa.findUnique({ where: { id: e.caixa_id }, select: { status: true } });
  if (caixa && caixa.status !== "aberto") return "O caixa já está fechado.";
  return null;
}

/**
 * Registra a autorização (uma por operação). Repetir o PIN da MESMA operação renova a autorização ainda não
 * usada; depois de consumida ela nunca mais é alterada. Devolve false se a operação já foi autorizada e usada.
 */
export async function registrarAutorizacao(e: EscopoAutorizacao, funcionarioId: string, usuarioId: string | null): Promise<boolean> {
  const dados = {
    funcionario_id: funcionarioId,
    usuario_id: usuarioId,
    permissao: permissaoDoEscopo(e),
    escopo: escopoCanonico(e),
    expira_em: new Date(Date.now() + VALIDADE_AUTORIZACAO_MS),
  };
  try {
    await prisma.autorizacaoCaixa.create({ data: { id: e.operacao_id, ...dados } });
    return true;
  } catch (erro) {
    if (!(erro instanceof Prisma.PrismaClientKnownRequestError) || erro.code !== "P2002") throw erro;
  }
  const r = await prisma.autorizacaoCaixa.updateMany({ where: { id: e.operacao_id, consumida_em: null }, data: dados });
  return r.count === 1;
}

/**
 * CONSOME a autorização dentro da transação que grava a operação. O UPDATE condicional é atômico: só uma
 * transação consegue marcá-la (consumida_em nulo → agora) e só se funcionário, login, permissão, escopo e
 * validade conferem. Se a operação falhar e a transação voltar, a autorização volta a valer junto.
 */
async function consumirAutorizacao(tx: Cliente, e: EscopoAutorizacao, autoria: Autoria): Promise<void> {
  const r = await tx.autorizacaoCaixa.updateMany({
    where: {
      id: e.operacao_id,
      funcionario_id: autoria.funcionario_id,
      usuario_id: autoria.usuario_id,
      permissao: permissaoDoEscopo(e),
      escopo: escopoCanonico(e),
      consumida_em: null,
      expira_em: { gt: new Date() },
    },
    data: { consumida_em: new Date() },
  });
  if (r.count !== 1) {
    throw new CaixaError("sem_autorizacao", "Operação administrativa sem autorização por PIN válida, vigente e não utilizada no servidor.");
  }
}

/** A operação (id) já foi aplicada? Reenvios de operações antigas não dependem de a autorização ainda valer. */
export async function operacaoJaAplicada(tipo: "movimento" | "estorno", id: string): Promise<boolean> {
  if (tipo === "movimento") return (await prisma.movimentoCaixa.count({ where: { id } })) > 0;
  return (await prisma.auditoriaCaixa.count({ where: { acao: "estorno", detalhes: { path: ["operacao_id"], equals: id } } })) > 0;
}


// ---------------------------------------------------------------------------
// Conflitos (preservados para tratamento explícito)
// ---------------------------------------------------------------------------

export async function registrarConflito(op: {
  id: string;
  tipo: string;
  caixa_id?: string | null;
  dispositivo?: string | null;
  usuario_id?: string | null;
  payload: unknown;
  motivo: string;
}): Promise<void> {
  try {
    await prisma.caixaConflito.create({
      data: {
        id: op.id,
        tipo: op.tipo,
        caixa_id: op.caixa_id ?? null,
        dispositivo: op.dispositivo ?? null,
        usuario_id: op.usuario_id ?? null,
        payload: op.payload as Prisma.InputJsonValue,
        motivo: op.motivo,
      },
    });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e; // reenvio: já registrado
  }
}

export async function listarConflitos(status: "pendente" | "tratado" = "pendente") {
  return prisma.caixaConflito.findMany({ where: { status }, orderBy: { created_at: "asc" }, take: 200 });
}

export async function tratarConflito(id: string, usuarioId: string, observacao: string): Promise<boolean> {
  const obs = textoLimpo(observacao, MAX_TEXTO.observacao);
  if (!obs) return false;
  const r = await prisma.caixaConflito.updateMany({
    where: { id, status: "pendente" },
    data: { status: "tratado", tratado_por: usuarioId, tratado_em: new Date(), observacao: obs },
  });
  return r.count === 1;
}

// ---------------------------------------------------------------------------
// Erros → resultado padronizado
// ---------------------------------------------------------------------------

function tratarErroOperacao(e: unknown, _idOperacao: string): ResultadoOperacao {
  if (e instanceof CaixaError) {
    switch (e.codigo) {
      case "caixa_inexistente":
        return { status: "aguardando", motivo: e.message };
      case "caixa_fechado":
      case "caixa_outro_terminal":
      case "terminal_ocupado":
      case "ja_estornado":
      case "sem_autorizacao":
        return { status: "conflito", motivo: e.message };
      default:
        return { status: "rejeitado", erro: e.message };
    }
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    // Mesma operação enviada duas vezes ao mesmo tempo: a outra venceu a corrida.
    return { status: "ok", jaExistia: true };
  }
  // O gatilho do banco recusa movimento em caixa fechado (corrida com o fechamento).
  if (e instanceof Error && /Caixa fechado ou inexistente/.test(e.message)) {
    return { status: "conflito", motivo: "O caixa já está fechado: movimentação recusada." };
  }
  throw e;
}

export type { DadosCartao, OrigemOperacao };
export { formaOk, origemOk };
