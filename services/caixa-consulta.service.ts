import { Prisma } from "@prisma/client";
import { prisma } from "./prisma/client";
import { serializar } from "./prisma/query-helpers";
import { resumirCaixa } from "@/lib/caixa/calculo";
import type { ConferenciaInformada, FormaCaixa, MovimentoResumo, ResumoCaixa, TipoMovimento } from "@/lib/caixa/tipos";

/** Consultas de caixa para histórico, detalhe e relatórios (somente leitura, uso administrativo). */

export interface FiltroCaixas {
  /** ISO (inclusive): filtra pela abertura do caixa. */
  inicio?: string | null;
  fim?: string | null;
  terminal_id?: string | null;
  /** Funcionário que abriu OU que fez algum movimento no caixa. */
  funcionario_id?: string | null;
  status?: "aberto" | "fechado" | null;
  somente_divergentes?: boolean;
  /** Restringe a estes caixas (detalhe). */
  ids?: string[];
}

export interface CaixaListado {
  id: string;
  terminal_id: string;
  terminal_papel: string | null;
  status: "aberto" | "fechado";
  aberto_em: string;
  fechado_em: string | null;
  fundo_inicial_centavos: number;
  aberto_por: string;
  fechado_por: string | null;
  origem_abertura: string;
  origem_fechamento: string | null;
  diferenca_dinheiro_centavos: number | null;
  diferenca_total_centavos: number | null;
  justificativa_divergencia: string | null;
  conferencia_status: "pendente" | "conferido" | null;
  conferencia_obs: string | null;
  reaberturas: number;
  /** Valores contados/informados no fechamento, por forma (centavos). Nulo se ainda não fechou. */
  conferencia: ConferenciaInformada | null;
  resumo: ResumoCaixa;
}

export interface MovimentoListado {
  id: string;
  caixa_id: string;
  tipo: TipoMovimento;
  sentido: "entrada" | "saida";
  forma_pagamento: FormaCaixa;
  valor_centavos: number;
  funcionario_id: string;
  funcionario_nome: string;
  usuario_nome: string | null;
  dispositivo: string;
  origem: "online" | "offline";
  origem_operacao: string;
  venda_id: string | null;
  estorno_de_id: string | null;
  descricao: string | null;
  justificativa: string | null;
  cartao_bandeira: string | null;
  cartao_adquirente: string | null;
  cartao_parcelas: number | null;
  cartao_taxa_centavos: number | null;
  transacao_id: string | null;
  ocorrido_em: string;
}

function janela(f: FiltroCaixas): Prisma.CaixaWhereInput {
  const where: Prisma.CaixaWhereInput = {};
  if (f.ids) where.id = { in: f.ids };
  if (f.inicio || f.fim) {
    where.aberto_em = {
      ...(f.inicio ? { gte: new Date(f.inicio) } : {}),
      ...(f.fim ? { lte: new Date(f.fim) } : {}),
    };
  }
  if (f.terminal_id) where.terminal_id = f.terminal_id;
  if (f.status) where.status = f.status;
  if (f.funcionario_id) {
    where.OR = [{ aberto_por_funcionario_id: f.funcionario_id }, { movimentos: { some: { funcionario_id: f.funcionario_id } } }];
  }
  if (f.somente_divergentes) where.diferenca_total_centavos = { not: 0 };
  return where;
}

function paraResumoMov(m: {
  id: string; tipo: string; sentido: string; forma_pagamento: string; valor_centavos: number;
  estorno_de_id: string | null; venda_id: string | null; cartao_taxa_centavos: number | null;
}): MovimentoResumo {
  return { ...m, tipo: m.tipo as TipoMovimento, sentido: m.sentido as "entrada" | "saida", forma_pagamento: m.forma_pagamento as FormaCaixa };
}

export const LIMITE_CAIXAS = 200;
export const LIMITE_MOVIMENTOS_RELATORIO = 20000;

export async function listarCaixas(filtro: FiltroCaixas = {}): Promise<CaixaListado[]> {
  const caixas = await prisma.caixa.findMany({
    where: janela(filtro),
    orderBy: { aberto_em: "desc" },
    take: LIMITE_CAIXAS,
    include: {
      aberto_por_funcionario: { select: { nome: true } },
      fechado_por_funcionario: { select: { nome: true } },
    },
  });
  const movs = await prisma.movimentoCaixa.findMany({
    where: { caixa_id: { in: caixas.map((c) => c.id) } },
    select: { caixa_id: true, id: true, tipo: true, sentido: true, forma_pagamento: true, valor_centavos: true, estorno_de_id: true, venda_id: true, cartao_taxa_centavos: true },
  });
  const porCaixa = new Map<string, MovimentoResumo[]>();
  for (const m of movs) {
    const lista = porCaixa.get(m.caixa_id) ?? [];
    lista.push(paraResumoMov(m));
    porCaixa.set(m.caixa_id, lista);
  }
  return serializar<CaixaListado[]>(
    caixas.map((c) => ({
      id: c.id,
      terminal_id: c.terminal_id,
      terminal_papel: c.terminal_papel,
      status: c.status,
      aberto_em: c.aberto_em,
      fechado_em: c.fechado_em,
      fundo_inicial_centavos: c.fundo_inicial_centavos,
      aberto_por: c.aberto_por_funcionario.nome,
      fechado_por: c.fechado_por_funcionario?.nome ?? null,
      origem_abertura: c.origem_abertura,
      origem_fechamento: c.origem_fechamento,
      diferenca_dinheiro_centavos: c.diferenca_dinheiro_centavos,
      diferenca_total_centavos: c.diferenca_total_centavos,
      justificativa_divergencia: c.justificativa_divergencia,
      conferencia_status: c.conferencia_status,
      conferencia_obs: c.conferencia_obs,
      reaberturas: c.reaberturas,
      conferencia: (c.conferencia as ConferenciaInformada | null) ?? null,
      resumo: resumirCaixa(c.fundo_inicial_centavos, porCaixa.get(c.id) ?? []),
    }))
  );
}

const SELECT_MOVIMENTO = {
  id: true, caixa_id: true, tipo: true, sentido: true, forma_pagamento: true, valor_centavos: true,
  funcionario_id: true, dispositivo: true, origem: true, origem_operacao: true, venda_id: true,
  estorno_de_id: true, descricao: true, justificativa: true, cartao_bandeira: true, cartao_adquirente: true,
  cartao_parcelas: true, cartao_taxa_centavos: true, transacao_id: true, ocorrido_em: true,
  funcionario: { select: { nome: true } },
  usuario: { select: { nome: true } },
} as const;

function paraMovimentoListado(m: Prisma.MovimentoCaixaGetPayload<{ select: typeof SELECT_MOVIMENTO }>): MovimentoListado {
  const { funcionario, usuario, ...resto } = m;
  return { ...resto, funcionario_nome: funcionario.nome, usuario_nome: usuario?.nome ?? null } as unknown as MovimentoListado;
}

export interface DetalheCaixa {
  caixa: CaixaListado;
  movimentos: MovimentoListado[];
  auditoria: {
    id: string; acao: string; funcionario_nome: string | null; usuario_nome: string | null;
    dispositivo: string | null; origem: string | null; detalhes: unknown; created_at: string;
  }[];
  conferencia: unknown;
  resumo_terminal: unknown;
}

export async function detalheCaixa(id: string): Promise<DetalheCaixa | null> {
  const [lista] = await listarCaixas({ ids: [id] });
  if (!lista) return null;
  const [movs, aud, bruto] = await Promise.all([
    prisma.movimentoCaixa.findMany({ where: { caixa_id: id }, orderBy: { ocorrido_em: "asc" }, select: SELECT_MOVIMENTO }),
    prisma.auditoriaCaixa.findMany({
      where: { caixa_id: id },
      orderBy: { created_at: "asc" },
      include: { funcionario: { select: { nome: true } }, usuario: { select: { nome: true } } },
    }),
    prisma.caixa.findUnique({ where: { id }, select: { conferencia: true, resumo_terminal: true } }),
  ]);
  return serializar<DetalheCaixa>({
    caixa: lista,
    movimentos: movs.map(paraMovimentoListado),
    auditoria: aud.map((a) => ({
      id: a.id, acao: a.acao, funcionario_nome: a.funcionario?.nome ?? null, usuario_nome: a.usuario?.nome ?? null,
      dispositivo: a.dispositivo, origem: a.origem, detalhes: a.detalhes, created_at: a.created_at,
    })),
    conferencia: bruto?.conferencia ?? null,
    resumo_terminal: bruto?.resumo_terminal ?? null,
  });
}

export interface DadosRelatorioCaixa {
  caixas: CaixaListado[];
  movimentos: MovimentoListado[];
  truncado: boolean;
}

/** Base única dos relatórios: caixas do período + seus movimentos. As visões são derivadas em lib/caixa/relatorios.ts. */
export async function dadosRelatorioCaixa(filtro: FiltroCaixas = {}): Promise<DadosRelatorioCaixa> {
  const caixas = await listarCaixas(filtro);
  const movs = await prisma.movimentoCaixa.findMany({
    where: { caixa_id: { in: caixas.map((c) => c.id) } },
    orderBy: { ocorrido_em: "asc" },
    take: LIMITE_MOVIMENTOS_RELATORIO + 1,
    select: SELECT_MOVIMENTO,
  });
  const truncado = movs.length > LIMITE_MOVIMENTOS_RELATORIO;
  return serializar<DadosRelatorioCaixa>({
    caixas,
    movimentos: movs.slice(0, LIMITE_MOVIMENTOS_RELATORIO).map(paraMovimentoListado),
    truncado: truncado || caixas.length >= LIMITE_CAIXAS,
  });
}

export async function listarTerminais(): Promise<{ terminal_id: string; terminal_papel: string | null; ultimo_uso: string }[]> {
  const grupos = await prisma.caixa.groupBy({ by: ["terminal_id"], _max: { aberto_em: true } });
  const detalhes = await prisma.caixa.findMany({
    where: { terminal_id: { in: grupos.map((g) => g.terminal_id) } },
    distinct: ["terminal_id"],
    orderBy: { aberto_em: "desc" },
    select: { terminal_id: true, terminal_papel: true },
  });
  const papel = new Map(detalhes.map((d) => [d.terminal_id, d.terminal_papel]));
  return serializar(
    grupos.map((g) => ({ terminal_id: g.terminal_id, terminal_papel: papel.get(g.terminal_id) ?? null, ultimo_uso: g._max.aberto_em }))
  );
}

// ---------------------------------------------------------------------------
// Recebimentos de contas a receber lançados no caixa (leitura pelo aparelho)
// ---------------------------------------------------------------------------

export interface RecebimentoLido {
  id: string;
  forma_pagamento: string;
  valor_centavos: number;
  funcionario_id: string;
  funcionario_nome: string;
  descricao: string | null;
  ocorrido_em: string;
}

/**
 * Lê os recebimentos de conta lançados num caixa, SE o chamador puder ver esse caixa. Devolve null em qualquer recusa
 * (caixa inexistente, terminal que não confere, usuário sem vínculo) — sem distinguir o motivo, para não servir de sonda
 * de identificadores.
 *
 * Vínculos que o modelo atual consegue PROVAR (não há tenant, e a sessão não é presa a um terminal):
 *  - o caixa pertence ao terminal informado (`caixas.terminal_id`);
 *  - administrador: pode ver qualquer caixa (as demais telas administrativas já permitem);
 *  - demais usuários: só se tiverem atuado NESTE caixa — abriram, fecharam ou lançaram algum movimento nele
 *    (`caixas.aberto_por_usuario_id`, `fechado_por_usuario_id`, `movimentos_caixa.usuario_id`).
 * Limitação: o terminal é um identificador gerado no navegador e a sessão não registra o terminal, então "este login está
 * fisicamente neste terminal" não é comprovável; o vínculo acima é o mais forte que os dados reais permitem.
 */
export async function lerRecebimentosDoCaixa(params: {
  caixaId: string;
  terminalId: string;
  usuarioId: string;
  admin: boolean;
}): Promise<RecebimentoLido[] | null> {
  const caixa = await prisma.caixa.findUnique({
    where: { id: params.caixaId },
    select: { terminal_id: true, aberto_por_usuario_id: true, fechado_por_usuario_id: true },
  });
  if (!caixa || caixa.terminal_id !== params.terminalId) return null;

  if (!params.admin) {
    const vinculado =
      caixa.aberto_por_usuario_id === params.usuarioId ||
      caixa.fechado_por_usuario_id === params.usuarioId ||
      (await prisma.movimentoCaixa.count({ where: { caixa_id: params.caixaId, usuario_id: params.usuarioId } })) > 0;
    if (!vinculado) return null;
  }

  const linhas = await prisma.movimentoCaixa.findMany({
    where: { caixa_id: params.caixaId, tipo: "recebimento_conta" },
    orderBy: { ocorrido_em: "asc" },
    select: { id: true, forma_pagamento: true, valor_centavos: true, funcionario_id: true, descricao: true, ocorrido_em: true, funcionario: { select: { nome: true } } },
  });
  return linhas.map((l) => ({
    id: l.id,
    forma_pagamento: l.forma_pagamento,
    valor_centavos: l.valor_centavos,
    funcionario_id: l.funcionario_id,
    funcionario_nome: l.funcionario.nome,
    descricao: l.descricao,
    ocorrido_em: l.ocorrido_em.toISOString(),
  }));
}
