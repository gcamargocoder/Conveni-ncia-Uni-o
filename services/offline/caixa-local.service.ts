import { getOfflineDB, type CaixaLocal, type ItemFilaSincronizacao, type MovimentoCaixaLocal } from "./db";
import { lerIdentificadorDispositivo, obterOuCriarIdentificadorDispositivo } from "./configuracao-local.service";
import { obterPapelDispositivo } from "./dispositivo.service";
import { registrarEventoAuditoriaLocal } from "./auditoria-local.service";
import { enfileirar } from "./fila-sincronizacao.service";
import { gerarUuid } from "@/lib/utils/uuid";
import { calcularDiferencas, haDivergencia, resumirCaixa } from "@/lib/caixa/calculo";
import {
  SENTIDO_DO_TIPO,
  type ConferenciaInformada,
  type FormaCaixa,
  type MovimentoResumo,
  type ResumoCaixa,
  type StatusCaixaExibicao,
  type TipoAvulso,
  statusExibicao,
} from "@/lib/caixa/tipos";
import { centavosOk, textoLimpo, validarMovimentoAvulso, type PagamentoVenda } from "@/lib/caixa/validacao";
import { recebimentosDoCaixaAction, type OperacaoCaixa, type RecebimentoDoCaixa } from "@/lib/caixa/actions";

/**
 * Caixa no aparelho (offline-first). Toda operação é gravada primeiro aqui, numa transação do
 * IndexedDB, e vai para a fila de sincronização na mesma transação — nada se perde se a internet cair.
 *
 * Regras de decisão (documentadas em CAIXA.md):
 *  - O caixa é do TERMINAL: no máximo um caixa "aberto" por aparelho; vários funcionários o movimentam,
 *    e cada movimento guarda o funcionário que digitou o PIN naquele momento (a autoria não muda depois).
 *  - Vender exige caixa aberto neste aparelho (e sem conflito pendente).
 *  - Fechar com internet e operações ainda pendentes: BLOQUEIA (tenta sincronizar antes). Fechar sem
 *    internet é permitido, fica "pendente de sincronização" e vai à fila DEPOIS das operações pendentes.
 *  - O resumo local nunca é apresentado como confirmado: só a resposta do servidor confirma o fechamento.
 */

export class CaixaLocalError extends Error {
  constructor(
    public readonly codigo:
      | "sem_caixa"
      | "caixa_ja_aberto"
      | "caixa_em_conflito"
      | "dados_invalidos"
      | "pendencias_de_sincronizacao"
      | "nao_estornavel",
    mensagem: string
  ) {
    super(mensagem);
    this.name = "CaixaLocalError";
  }
}

export function estaOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export interface Responsavel {
  id: string;
  nome: string;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export async function obterCaixaAbertoLocal(): Promise<CaixaLocal | undefined> {
  const db = getOfflineDB();
  // Só leitura: roda dentro de useLiveQuery (transação de leitura). Sem identificador ainda, não há caixa deste terminal.
  const terminal = await lerIdentificadorDispositivo();
  if (!terminal) return undefined;
  const abertos = await db.caixas_locais.where("terminal_id").equals(terminal).and((c) => c.status === "aberto").toArray();
  return abertos.sort((a, b) => b.aberto_em.localeCompare(a.aberto_em))[0];
}

export async function listarCaixasLocais(limite = 50): Promise<CaixaLocal[]> {
  const db = getOfflineDB();
  return db.caixas_locais.orderBy("aberto_em").reverse().limit(limite).toArray();
}

/**
 * Incorpora ao caixa local os recebimentos de contas a receber que o servidor lançou nele (entram no saldo esperado).
 * Só ACRESCENTA o que ainda não existe (pelo id do servidor) e já como sincronizado — nunca altera nem apaga nada local.
 */
export async function mesclarRecebimentosDoServidor(caixa: Pick<CaixaLocal, "id" | "terminal_id">, itens: RecebimentoDoCaixa[]): Promise<number> {
  const db = getOfflineDB();
  const novos: MovimentoCaixaLocal[] = [];
  for (const r of itens) {
    if (await db.movimentos_caixa_locais.get(r.id)) continue;
    novos.push({
      id: r.id,
      caixa_id: caixa.id,
      operacao_id: r.id,
      tipo: "recebimento_conta",
      sentido: "entrada",
      forma_pagamento: r.forma_pagamento as MovimentoCaixaLocal["forma_pagamento"],
      valor_centavos: r.valor_centavos,
      funcionario_id: r.funcionario_id,
      funcionario_nome: r.funcionario_nome,
      dispositivo: caixa.terminal_id,
      origem: "online",
      origem_operacao: "conta_receber",
      venda_id: null,
      estorno_de_id: null,
      ordem: null,
      descricao: r.descricao,
      justificativa: null,
      cartao_bandeira: null,
      cartao_adquirente: null,
      cartao_parcelas: null,
      cartao_taxa_centavos: null,
      transacao_id: null,
      ocorrido_em: r.ocorrido_em,
      sincronizado: true,
    });
  }
  if (novos.length > 0) await db.movimentos_caixa_locais.bulkPut(novos);
  return novos.length;
}

/** Busca no servidor (se online) os recebimentos do caixa deste terminal e os incorpora. Falhas são silenciosas: tenta de novo depois. */
export async function atualizarRecebimentosDoServidor(caixa: Pick<CaixaLocal, "id" | "terminal_id" | "abertura_sincronizada">): Promise<number> {
  if (!caixa.abertura_sincronizada || !estaOnline()) return 0;
  try {
    const r = await recebimentosDoCaixaAction(caixa.id, caixa.terminal_id);
    return r.sucesso ? await mesclarRecebimentosDoServidor(caixa, r.itens) : 0;
  } catch {
    return 0;
  }
}

export async function listarMovimentosLocais(caixaId: string): Promise<MovimentoCaixaLocal[]> {
  const db = getOfflineDB();
  const lista = await db.movimentos_caixa_locais.where("caixa_id").equals(caixaId).toArray();
  // Desempate pela ordem do pagamento: lançamentos da mesma venda têm o mesmo horário.
  return lista.sort((a, b) => a.ocorrido_em.localeCompare(b.ocorrido_em) || (a.ordem ?? 0) - (b.ordem ?? 0));
}

function paraResumo(m: MovimentoCaixaLocal): MovimentoResumo {
  return {
    id: m.id,
    tipo: m.tipo,
    sentido: m.sentido,
    forma_pagamento: m.forma_pagamento,
    valor_centavos: m.valor_centavos,
    estorno_de_id: m.estorno_de_id,
    venda_id: m.venda_id,
    cartao_taxa_centavos: m.cartao_taxa_centavos,
  };
}

export async function resumoLocal(caixaId: string): Promise<ResumoCaixa | null> {
  const db = getOfflineDB();
  const caixa = await db.caixas_locais.get(caixaId);
  if (!caixa) return null;
  return resumirCaixa(caixa.fundo_inicial_centavos, (await listarMovimentosLocais(caixaId)).map(paraResumo));
}

export function statusDoCaixaLocal(c: CaixaLocal): StatusCaixaExibicao {
  return statusExibicao({
    status: c.status,
    fechamentoConfirmadoNoServidor: c.fechamento_confirmado_servidor,
    diferenca_total_centavos: c.diferenca_total_centavos,
    conferencia_status: null,
  });
}

/** Operações do caixa que ainda não chegaram ao servidor (bloqueiam o fechamento online). */
export interface PendenciasCaixa {
  /** pendente | erro | sincronizando — ainda serão enviadas. */
  aguardando: number;
  /** O servidor reteve (revisão/conflito): ficam fora do caixa oficial até o administrador decidir. */
  retidas: number;
}

function caixaDoItem(item: ItemFilaSincronizacao): string | null {
  try {
    const p = JSON.parse(item.payload) as Record<string, unknown> & { dados?: { caixa_id?: string } };
    if (item.tipo === "venda") return (p.caixa_id as string) ?? null;
    if (item.tipo === "caixa_abertura") return item.id;
    return p.dados?.caixa_id ?? null;
  } catch {
    return null;
  }
}

export async function pendenciasDoCaixa(caixaId: string): Promise<PendenciasCaixa> {
  const db = getOfflineDB();
  const itens = await db.fila_sincronizacao.toArray();
  let aguardando = 0;
  let retidas = 0;
  for (const item of itens) {
    if (item.tipo === "caixa_fechamento") continue;
    if (caixaDoItem(item) !== caixaId) continue;
    if (item.status === "pendente" || item.status === "erro" || item.status === "sincronizando") aguardando++;
    else if (item.status === "em_revisao" || item.status === "rejeitada") retidas++;
  }
  return { aguardando, retidas };
}

async function contexto() {
  const terminal_id = await obterOuCriarIdentificadorDispositivo();
  const papel = await obterPapelDispositivo();
  return { terminal_id, terminal_papel: papel?.tipo ?? "principal" };
}

async function exigirCaixaAberto(): Promise<CaixaLocal> {
  const caixa = await obterCaixaAbertoLocal();
  if (!caixa) throw new CaixaLocalError("sem_caixa", "Abra o caixa antes de realizar operações.");
  if (caixa.conflito) {
    throw new CaixaLocalError("caixa_em_conflito", "Este caixa está em conflito com o servidor. Procure um administrador.");
  }
  return caixa;
}

function operacao<T extends OperacaoCaixa["tipo"]>(
  tipo: T,
  id: string,
  responsavel: Responsavel,
  terminal: string,
  dados: Extract<OperacaoCaixa, { tipo: T }>["dados"]
): Extract<OperacaoCaixa, { tipo: T }> {
  return {
    tipo,
    id,
    funcionario_id: responsavel.id,
    dispositivo: terminal,
    origem: estaOnline() ? "online" : "offline",
    dados,
  } as Extract<OperacaoCaixa, { tipo: T }>;
}

// ---------------------------------------------------------------------------
// Abertura
// ---------------------------------------------------------------------------

export interface DadosAbertura {
  fundoInicialCentavos: number;
  observacoes?: string | null;
  responsavel: Responsavel;
}

export async function abrirCaixaLocal(dados: DadosAbertura): Promise<CaixaLocal> {
  if (!centavosOk(dados.fundoInicialCentavos, { permitirZero: true })) {
    throw new CaixaLocalError("dados_invalidos", "Informe um fundo de troco válido (pode ser zero).");
  }
  const db = getOfflineDB();
  const { terminal_id, terminal_papel } = await contexto();
  const agora = new Date().toISOString();
  const id = gerarUuid();
  const origem = estaOnline() ? "online" : "offline";

  const caixa: CaixaLocal = {
    id,
    terminal_id,
    terminal_papel,
    status: "aberto",
    fundo_inicial_centavos: dados.fundoInicialCentavos,
    observacoes_abertura: textoLimpo(dados.observacoes, 300),
    aberto_em: agora,
    aberto_por_funcionario_id: dados.responsavel.id,
    aberto_por_funcionario_nome: dados.responsavel.nome,
    origem_abertura: origem,
    abertura_sincronizada: false,
    fechado_em: null,
    fechado_por_funcionario_id: null,
    fechado_por_funcionario_nome: null,
    origem_fechamento: null,
    conferencia: null,
    justificativa_divergencia: null,
    resumo_local: null,
    diferencas_local: null,
    diferenca_total_centavos: null,
    fechamento_confirmado_servidor: false,
    resumo_servidor: null,
    conflito: null,
  };

  // A checagem "já existe caixa aberto" e a gravação acontecem na MESMA transação do IndexedDB:
  // duas abas não conseguem abrir dois caixas no mesmo terminal.
  await db.transaction("rw", db.caixas_locais, db.fila_sincronizacao, async () => {
    const existente = await db.caixas_locais.where("terminal_id").equals(terminal_id).and((c) => c.status === "aberto").first();
    if (existente) throw new CaixaLocalError("caixa_ja_aberto", "Este terminal já tem um caixa aberto.");
    await db.caixas_locais.put(caixa);
    await enfileirar(
      id,
      "caixa_abertura",
      operacao("abertura", id, dados.responsavel, terminal_id, {
        id,
        terminal_id,
        terminal_papel,
        fundo_inicial_centavos: dados.fundoInicialCentavos,
        observacoes: caixa.observacoes_abertura,
        aberto_em: agora,
      })
    );
  });
  await registrarEventoAuditoriaLocal("caixa_aberto", {
    funcionario_id: dados.responsavel.id,
    dispositivo: terminal_id,
    detalhes: `caixa=${id} fundo=${dados.fundoInicialCentavos}`,
  });
  return caixa;
}

// ---------------------------------------------------------------------------
// Venda (usado por registrarVendaLocal, dentro da transação da venda)
// ---------------------------------------------------------------------------

/** Monta os movimentos de uma venda: um por forma de pagamento (pagamento dividido). */
export function movimentosDaVenda(args: {
  caixa: CaixaLocal;
  vendaId: string;
  pagamentos: PagamentoVenda[];
  responsavel: Responsavel;
  ocorridoEm: string;
}): MovimentoCaixaLocal[] {
  return args.pagamentos.map((p, ordem) => ({
    id: gerarUuid(),
    caixa_id: args.caixa.id,
    operacao_id: args.vendaId,
    tipo: "venda",
    sentido: "entrada",
    forma_pagamento: p.forma,
    valor_centavos: p.valor_centavos,
    funcionario_id: args.responsavel.id,
    funcionario_nome: args.responsavel.nome,
    dispositivo: args.caixa.terminal_id,
    origem: estaOnline() ? "online" : "offline",
    origem_operacao: "pdv",
    venda_id: args.vendaId,
    estorno_de_id: null,
    ordem,
    descricao: "Venda no PDV",
    justificativa: null,
    cartao_bandeira: p.cartao?.bandeira ?? null,
    cartao_adquirente: p.cartao?.adquirente ?? null,
    cartao_parcelas: p.cartao?.parcelas ?? null,
    cartao_taxa_centavos: p.cartao?.taxa_centavos ?? null,
    transacao_id: p.cartao?.transacao_id ?? null,
    ocorrido_em: args.ocorridoEm,
    sincronizado: false,
  }));
}

export { exigirCaixaAberto as exigirCaixaAbertoLocal };

// ---------------------------------------------------------------------------
// Movimentos avulsos (sangria, suprimento, despesa, ajustes)
// ---------------------------------------------------------------------------

export interface DadosMovimentoAvulso {
  tipo: TipoAvulso;
  valorCentavos: number;
  justificativa: string;
  descricao?: string | null;
  responsavel: Responsavel;
  /** Id da operação, quando já foi usado para pedir a autorização do servidor. */
  operacaoId?: string;
}

export async function registrarMovimentoAvulsoLocal(dados: DadosMovimentoAvulso): Promise<MovimentoCaixaLocal> {
  const caixa = await exigirCaixaAberto();
  const id = dados.operacaoId ?? gerarUuid();
  const ocorrido_em = new Date().toISOString();
  const erros = validarMovimentoAvulso({
    id,
    caixa_id: caixa.id,
    tipo: dados.tipo,
    valor_centavos: dados.valorCentavos,
    justificativa: dados.justificativa,
    ocorrido_em,
  });
  if (erros.length > 0) throw new CaixaLocalError("dados_invalidos", erros[0]);

  // Sangria/despesa não podem tirar mais dinheiro do que há na gaveta.
  if (SENTIDO_DO_TIPO[dados.tipo] === "saida") {
    const resumo = await resumoLocal(caixa.id);
    if (resumo && dados.valorCentavos > resumo.dinheiro.saldo_esperado_centavos) {
      throw new CaixaLocalError("dados_invalidos", "O valor é maior que o dinheiro esperado no caixa.");
    }
  }

  const mov: MovimentoCaixaLocal = {
    id,
    caixa_id: caixa.id,
    operacao_id: id,
    tipo: dados.tipo,
    sentido: SENTIDO_DO_TIPO[dados.tipo],
    forma_pagamento: "dinheiro",
    valor_centavos: dados.valorCentavos,
    funcionario_id: dados.responsavel.id,
    funcionario_nome: dados.responsavel.nome,
    dispositivo: caixa.terminal_id,
    origem: estaOnline() ? "online" : "offline",
    origem_operacao: "caixa",
    venda_id: null,
    estorno_de_id: null,
    ordem: null,
    descricao: textoLimpo(dados.descricao, 200),
    justificativa: textoLimpo(dados.justificativa, 300),
    cartao_bandeira: null,
    cartao_adquirente: null,
    cartao_parcelas: null,
    cartao_taxa_centavos: null,
    transacao_id: null,
    ocorrido_em,
    sincronizado: false,
  };
  const db = getOfflineDB();
  await db.transaction("rw", db.movimentos_caixa_locais, db.fila_sincronizacao, async () => {
    await db.movimentos_caixa_locais.put(mov);
    await enfileirar(
      id,
      "caixa_movimento",
      operacao("movimento", id, dados.responsavel, caixa.terminal_id, {
        id,
        caixa_id: caixa.id,
        tipo: dados.tipo,
        valor_centavos: dados.valorCentavos,
        descricao: mov.descricao,
        justificativa: mov.justificativa ?? "",
        ocorrido_em,
      })
    );
  });
  await registrarEventoAuditoriaLocal("caixa_movimento", {
    funcionario_id: dados.responsavel.id,
    dispositivo: caixa.terminal_id,
    detalhes: `${dados.tipo} ${dados.valorCentavos}`,
  });
  return mov;
}

// ---------------------------------------------------------------------------
// Estorno / cancelamento de venda
// ---------------------------------------------------------------------------

export interface DadosEstorno {
  vendaId?: string;
  movimentoId?: string;
  justificativa: string;
  responsavel: Responsavel;
  /** Id da operação, quando já foi usado para pedir a autorização do servidor. */
  operacaoId?: string;
}

export async function estornarLocal(dados: DadosEstorno): Promise<MovimentoCaixaLocal[]> {
  const caixa = await exigirCaixaAberto();
  if (!!dados.vendaId === !!dados.movimentoId) throw new CaixaLocalError("dados_invalidos", "Informe a venda OU o movimento.");
  const justificativa = textoLimpo(dados.justificativa, 300);
  if (!justificativa) throw new CaixaLocalError("dados_invalidos", "Informe o motivo do estorno.");

  const db = getOfflineDB();
  const todos = await listarMovimentosLocais(caixa.id);
  const originais = dados.vendaId
    ? todos.filter((m) => m.venda_id === dados.vendaId && m.tipo === "venda")
    : todos.filter((m) => m.id === dados.movimentoId);
  if (originais.length === 0) {
    throw new CaixaLocalError("nao_estornavel", "Lançamento não encontrado neste caixa (estornos de caixas anteriores são feitos pelo administrador).");
  }
  if (originais.some((m) => m.tipo === "estorno")) throw new CaixaLocalError("nao_estornavel", "Um estorno não pode ser estornado.");
  if (originais.some((m) => m.forma_pagamento === "fiado")) {
    throw new CaixaLocalError("nao_estornavel", "Vendas com parte em fiado não podem ser estornadas pelo caixa.");
  }
  const jaEstornados = new Set(todos.map((m) => m.estorno_de_id).filter(Boolean));
  if (originais.some((m) => jaEstornados.has(m.id))) throw new CaixaLocalError("nao_estornavel", "Este lançamento já foi estornado.");

  const opId = dados.operacaoId ?? gerarUuid();
  const ocorrido_em = new Date().toISOString();
  const origem = estaOnline() ? "online" : "offline";
  const estornos: MovimentoCaixaLocal[] = originais.map((o) => ({
    ...o,
    id: gerarUuid(),
    operacao_id: opId,
    tipo: "estorno",
    sentido: o.sentido === "entrada" ? "saida" : "entrada",
    funcionario_id: dados.responsavel.id,
    funcionario_nome: dados.responsavel.nome,
    origem,
    origem_operacao: "caixa",
    venda_id: null,
    estorno_de_id: o.id,
    ordem: null,
    descricao: dados.vendaId ? "Cancelamento de venda" : "Estorno de movimentação",
    justificativa,
    cartao_taxa_centavos: null,
    ocorrido_em,
    sincronizado: false,
  }));

  await db.transaction("rw", db.movimentos_caixa_locais, db.vendas_locais, db.fila_sincronizacao, async () => {
    await db.movimentos_caixa_locais.bulkPut(estornos);
    if (dados.vendaId) await db.vendas_locais.update(dados.vendaId, { cancelada: true });
    await enfileirar(
      opId,
      "caixa_estorno",
      operacao("estorno", opId, dados.responsavel, caixa.terminal_id, {
        id: opId,
        caixa_id: caixa.id,
        venda_id: dados.vendaId ?? null,
        movimento_id: dados.movimentoId ?? null,
        justificativa,
        ocorrido_em,
      })
    );
  });
  await registrarEventoAuditoriaLocal("caixa_estorno", {
    funcionario_id: dados.responsavel.id,
    dispositivo: caixa.terminal_id,
    venda_id: dados.vendaId,
    detalhes: justificativa,
  });
  return estornos;
}

// ---------------------------------------------------------------------------
// Fechamento
// ---------------------------------------------------------------------------

export interface DadosFechamento {
  conferencia: ConferenciaInformada;
  justificativa?: string | null;
  responsavel: Responsavel;
  /** Padrão: navigator.onLine. Explícito nos testes. */
  online?: boolean;
}

export interface PreviaFechamento {
  resumo: ResumoCaixa;
  diferencas: ReturnType<typeof calcularDiferencas>;
  exigeJustificativa: boolean;
  pendencias: PendenciasCaixa;
}

export async function previaFechamento(conferencia: ConferenciaInformada): Promise<PreviaFechamento> {
  const caixa = await exigirCaixaAberto();
  const resumo = (await resumoLocal(caixa.id))!;
  const diferencas = calcularDiferencas(resumo, conferencia);
  return { resumo, diferencas, exigeJustificativa: haDivergencia(diferencas), pendencias: await pendenciasDoCaixa(caixa.id) };
}

export async function fecharCaixaLocal(dados: DadosFechamento): Promise<CaixaLocal> {
  const caixa = await exigirCaixaAberto();
  const online = dados.online ?? estaOnline();

  if (!centavosOk(dados.conferencia.dinheiro_centavos, { permitirZero: true })) {
    throw new CaixaLocalError("dados_invalidos", "Informe o valor contado em dinheiro.");
  }
  const pendencias = await pendenciasDoCaixa(caixa.id);
  if (online && pendencias.aguardando > 0) {
    throw new CaixaLocalError(
      "pendencias_de_sincronizacao",
      `Há ${pendencias.aguardando} operação(ões) deste caixa ainda não enviadas ao servidor. Aguarde a sincronização para fechar com segurança.`
    );
  }

  const resumo = (await resumoLocal(caixa.id))!;
  const diferencas = calcularDiferencas(resumo, dados.conferencia);
  const justificativa = textoLimpo(dados.justificativa, 300);
  if (haDivergencia(diferencas) && !justificativa) {
    throw new CaixaLocalError("dados_invalidos", "Há diferença na conferência: informe a justificativa.");
  }

  const fechado_em = new Date().toISOString();
  const origem = online ? "online" : "offline";
  const db = getOfflineDB();
  const atualizado: CaixaLocal = {
    ...caixa,
    status: "fechado",
    fechado_em,
    fechado_por_funcionario_id: dados.responsavel.id,
    fechado_por_funcionario_nome: dados.responsavel.nome,
    origem_fechamento: origem,
    conferencia: dados.conferencia,
    justificativa_divergencia: justificativa,
    resumo_local: resumo,
    diferencas_local: diferencas.por_forma,
    diferenca_total_centavos: diferencas.diferenca_total_centavos,
    fechamento_confirmado_servidor: false,
  };
  const opId = gerarUuid();
  await db.transaction("rw", db.caixas_locais, db.fila_sincronizacao, async () => {
    await db.caixas_locais.put(atualizado);
    await enfileirar(
      opId,
      "caixa_fechamento",
      operacao("fechamento", opId, dados.responsavel, caixa.terminal_id, {
        caixa_id: caixa.id,
        fechado_em,
        conferencia: dados.conferencia,
        justificativa,
        resumo_terminal: resumo,
      })
    );
  });
  await registrarEventoAuditoriaLocal("caixa_fechado", {
    funcionario_id: dados.responsavel.id,
    dispositivo: caixa.terminal_id,
    detalhes: `caixa=${caixa.id} origem=${origem} pendencias=${pendencias.aguardando}`,
  });
  return atualizado;
}

// ---------------------------------------------------------------------------
// Atualizações vindas da sincronização (chamadas pelo worker)
// ---------------------------------------------------------------------------

export async function marcarAberturaSincronizada(caixaId: string): Promise<void> {
  await getOfflineDB().caixas_locais.update(caixaId, { abertura_sincronizada: true, conflito: null });
}

export async function marcarOperacaoSincronizada(operacaoId: string): Promise<void> {
  const db = getOfflineDB();
  await db.movimentos_caixa_locais.where("operacao_id").equals(operacaoId).modify({ sincronizado: true });
}

export async function marcarFechamentoConfirmado(caixaId: string, resumoServidor: unknown): Promise<void> {
  await getOfflineDB().caixas_locais.update(caixaId, { fechamento_confirmado_servidor: true, resumo_servidor: resumoServidor ?? null });
}

export async function marcarConflitoDoCaixa(caixaId: string, motivo: string): Promise<void> {
  await getOfflineDB().caixas_locais.update(caixaId, { conflito: motivo });
  await registrarEventoAuditoriaLocal("caixa_conflito", { detalhes: `caixa=${caixaId}: ${motivo}` });
}

export type { FormaCaixa };
