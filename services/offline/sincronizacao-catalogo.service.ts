import { getOfflineDB, ProdutoLocal, CategoriaLocal, EstoqueLocal, FuncionarioLocal, ClienteLocal } from "./db";
import { obterConfiguracao, definirConfiguracao } from "./configuracao-local.service";
import { registrarEventoSincronizacao } from "./auditoria-sincronizacao.service";
import { buscarPaginaCatalogoAction, AlteracoesCatalogo } from "@/lib/offline-sync/actions";
import {
  ENTIDADES_CATALOGO,
  AJUSTES_SINCRONIZACAO,
  TAMANHO_PAGINA_CATALOGO,
  type CursorPagina,
  type EntidadeCatalogo,
  type PaginaCatalogo,
} from "@/lib/offline-sync/catalogo-paginas";
import { MAX_VENDAS_LOCAIS } from "@/lib/offline-sync/validar-pagina";
import { sincronizarCredenciaisPin } from "./credenciais-pin-local.service";
import { adquirirTrava, type Trava } from "./trava-sincronizacao.service";

const CHAVE_CARIMBO = "ultima_sincronizacao_catalogo";
const CHAVE_ULTIMA_QTD = "ultima_qtd_produtos_sincronizados";
/** Rodada em andamento (retomável após queda de internet ou fechamento do navegador). */
const CHAVE_PROGRESSO = "progresso_sincronizacao_catalogo";
/**
 * Versão do protocolo. Aparelhos que sincronizaram com o protocolo antigo (sem esta chave) podem ter um cursor
 * gravado depois de uma leitura truncada em 500/1.000: eles refazem UMA sincronização completa (só grava por cima,
 * nunca apaga) e então passam a usar o cursor normalmente.
 */
const CHAVE_VERSAO = "versao_sincronizacao_catalogo";
const VERSAO_PROTOCOLO = "2";

export interface ContagemSincronizacao {
  produtos: number;
  categorias: number;
  estoque: number;
  funcionarios: number;
  clientes: number;
}

export async function aplicarAlteracoesCatalogoLocal(
  alteracoes: AlteracoesCatalogo,
  /** Executado DENTRO da mesma transação: gravar o progresso junto com a página a torna atômica (ou as duas, ou nenhuma). */
  naMesmaTransacao?: () => Promise<void>
): Promise<ContagemSincronizacao> {
  const db = getOfflineDB();
  const agora = new Date().toISOString();

  const produtosLocal: ProdutoLocal[] = alteracoes.produtos.map((p) => ({
    id: p.id,
    nome: p.nome,
    preco_venda: p.preco_venda,
    codigo_barras: p.codigo_barras,
    categoria_id: p.categoria_id,
    ativo: p.ativo && !p.deleted_at,
    updated_at: p.updated_at,
  }));

  const categoriasLocal: CategoriaLocal[] = alteracoes.categorias.map((c) => ({
    id: c.id,
    nome: c.nome,
    ativo: c.ativo,
    updated_at: c.updated_at ?? agora,
  }));

  const estoqueLocal: EstoqueLocal[] = alteracoes.estoque.map((e) => ({
    produto_id: e.produto_id,
    quantidade_atual: e.quantidade_atual,
    estoque_minimo: e.estoque_minimo,
    updated_at: agora,
  }));

  const funcionariosLocal: FuncionarioLocal[] = alteracoes.funcionarios.map((f) => ({
    id: f.id,
    nome: f.nome,
    cargo: f.cargo,
    ativo: f.ativo && !f.deleted_at,
    updated_at: f.updated_at,
  }));

  const clientesLocal: ClienteLocal[] = alteracoes.clientes.map((c) => ({
    id: c.id,
    nome: c.nome,
    telefone: c.telefone,
    ativo: c.ativo && !c.deleted_at,
    updated_at: c.updated_at,
  }));

  await db.transaction(
    "rw",
    [db.produtos_local, db.categorias_local, db.estoque_local, db.funcionarios_local, db.clientes_local, db.configuracoes_local],
    async () => {
      if (produtosLocal.length) await db.produtos_local.bulkPut(produtosLocal);
      if (categoriasLocal.length) await db.categorias_local.bulkPut(categoriasLocal);
      if (estoqueLocal.length) await db.estoque_local.bulkPut(estoqueLocal);
      if (funcionariosLocal.length) await db.funcionarios_local.bulkPut(funcionariosLocal);
      if (clientesLocal.length) await db.clientes_local.bulkPut(clientesLocal);
      if (naMesmaTransacao) await naMesmaTransacao();
    }
  );

  return {
    produtos: produtosLocal.length,
    categorias: categoriasLocal.length,
    estoque: estoqueLocal.length,
    funcionarios: funcionariosLocal.length,
    clientes: clientesLocal.length,
  };
}

export interface ResultadoSincronizacaoCatalogo {
  sucesso: boolean;
  contagem?: ContagemSincronizacao;
  erro?: string;
}

type Contagens = Record<EntidadeCatalogo, number>;

interface Progresso {
  v: 1;
  /** Início da janela desta rodada (null = completa). */
  desde: string | null;
  /** Instante-limite fixado pelo servidor na primeira página. */
  ate: string | null;
  /** Cursor que será gravado ao concluir (`ate` recuado até a transação aberta mais antiga; ver catalogo-sync.service). */
  marca: string | null;
  cursores: Partial<Record<EntidadeCatalogo, CursorPagina>>;
  concluidas: EntidadeCatalogo[];
  contagens: Contagens;
}

const ZERO: Contagens = { categorias: 0, produtos: 0, estoque: 0, clientes: 0, funcionarios: 0 };

async function lerProgresso(): Promise<Progresso | null> {
  const bruto = await obterConfiguracao(CHAVE_PROGRESSO);
  if (!bruto) return null;
  try {
    const p = JSON.parse(bruto) as Progresso;
    if (p?.v !== 1 || !Array.isArray(p.concluidas) || typeof p.cursores !== "object") return null;
    return { ...p, marca: p.marca ?? null, contagens: { ...ZERO, ...p.contagens } };
  } catch {
    return null; // progresso ilegível: recomeça a rodada (idempotente), nunca trava
  }
}

async function novoProgresso(): Promise<Progresso> {
  const cursor = await obterConfiguracao(CHAVE_CARIMBO);
  const versao = await obterConfiguracao(CHAVE_VERSAO);
  let desde: string | null = null;
  if (cursor && versao === VERSAO_PROTOCOLO && !Number.isNaN(Date.parse(cursor))) {
    desde = new Date(Date.parse(cursor) - AJUSTES_SINCRONIZACAO.sobreposicaoMs).toISOString();
  }
  return { v: 1, desde, ate: null, marca: null, cursores: {}, concluidas: [], contagens: { ...ZERO } };
}

function paginaComoAlteracoes(entidade: EntidadeCatalogo, pagina: PaginaCatalogo): AlteracoesCatalogo {
  const vazio = { produtos: [], categorias: [], estoque: [], funcionarios: [], clientes: [] };
  return { ...vazio, [entidade]: pagina.itens, timestampServidor: pagina.ate } as AlteracoesCatalogo;
}

/** Progresso depois de gravar `pagina` (função pura: não grava nada). */
function avancar(p: Progresso, entidade: EntidadeCatalogo, pagina: PaginaCatalogo): Progresso {
  const novo: Progresso = {
    ...p,
    ate: pagina.ate,
    marca: p.marca ?? pagina.marca ?? pagina.ate,
    cursores: { ...p.cursores },
    concluidas: [...p.concluidas],
    contagens: { ...p.contagens, [entidade]: p.contagens[entidade] + pagina.itens.length },
  };
  if (pagina.proximo) novo.cursores[entidade] = pagina.proximo;
  else {
    delete novo.cursores[entidade];
    novo.concluidas.push(entidade);
  }
  return novo;
}

// ---------------------------------------------------------------------------------------------------------------
// Estoque × vendas offline pendentes
//
// A venda feita offline baixa `estoque_local` na hora e entra na fila; o servidor só desconta quando a venda chega
// (gatilho em itens_venda). O saldo que o servidor manda NÃO inclui as vendas ainda não enviadas — gravá-lo por cima
// "desfaria" a baixa. Por isso cada saldo recebido é gravado como  saldo_do_servidor − vendas pendentes do aparelho
// que o servidor ainda não tem. "Ainda não tem" é decidido PELO SERVIDOR, no mesmo instante em que ele leu os saldos
// (`vendas_no_servidor`), não pelo estado da fila do aparelho (que pode mudar no meio do caminho).
// ---------------------------------------------------------------------------------------------------------------

/** Vendas que serão enviadas sozinhas e que o servidor pode ainda não ter. (em_revisao/rejeitada: o servidor não as gravou nem reserva estoque para elas.) */
const NAO_CONFIRMADAS = new Set(["pendente", "sincronizando", "erro"]);
const TENTATIVAS_CORRIDA = 4;

async function vendasNaoConfirmadas(): Promise<string[]> {
  const itens = await getOfflineDB().fila_sincronizacao.where("tipo").equals("venda").toArray();
  return itens.filter((i) => NAO_CONFIRMADAS.has(i.status)).map((i) => i.id);
}

function itensDaVenda(payload: string): { produto_id: string; quantidade: number }[] {
  try {
    const itens = (JSON.parse(payload) as { itens?: { produto_id: string; quantidade: number }[] }).itens;
    return Array.isArray(itens) ? itens : [];
  } catch {
    return [];
  }
}

/**
 * Grava uma página de estoque já reconciliada, NA MESMA transação do progresso. Devolve false (sem gravar nada)
 * se apareceu uma venda no aparelho depois que o pedido saiu: o servidor não pode ter considerado essa venda
 * (nem sabemos se ele a recebeu antes de ler), então a página é pedida de novo.
 */
async function aplicarPaginaEstoque(
  pagina: PaginaCatalogo,
  candidatas: string[],
  inicioPedidoIso: string,
  trava: Trava,
  progresso: Progresso
): Promise<boolean> {
  const db = getOfflineDB();
  const noServidor = new Set(pagina.vendas_no_servidor ?? []);
  const conhecidas = new Set(candidatas);

  return db.transaction("rw", [db.estoque_local, db.fila_sincronizacao, db.configuracoes_local], async () => {
    await trava.verificarERenovar();

    const fila = await db.fila_sincronizacao.where("tipo").equals("venda").toArray();
    const corrida = fila.some((i) => !conhecidas.has(i.id) && (NAO_CONFIRMADAS.has(i.status) || i.criado_em >= inicioPedidoIso));
    if (corrida) return false;

    const abater = new Map<string, number>();
    for (const item of fila) {
      if (!conhecidas.has(item.id) || noServidor.has(item.id)) continue;
      if (item.status === "em_revisao" || item.status === "rejeitada") continue;
      for (const i of itensDaVenda(item.payload)) abater.set(i.produto_id, (abater.get(i.produto_id) ?? 0) + Number(i.quantidade));
    }

    const agora = new Date().toISOString();
    const linhas: EstoqueLocal[] = (pagina.itens as AlteracoesCatalogo["estoque"]).map((e) => ({
      produto_id: e.produto_id,
      quantidade_atual: Math.round((e.quantidade_atual - (abater.get(e.produto_id) ?? 0)) * 1000) / 1000,
      estoque_minimo: e.estoque_minimo,
      updated_at: agora,
    }));
    if (linhas.length) await db.estoque_local.bulkPut(linhas);
    await db.configuracoes_local.put({ chave: CHAVE_PROGRESSO, valor: JSON.stringify(progresso) });
    return true;
  });
}

async function paginaDeEstoque(p: Progresso, apos: CursorPagina | null, trava: Trava): Promise<Progresso> {
  for (let tentativa = 1; tentativa <= TENTATIVAS_CORRIDA; tentativa++) {
    const inicio = new Date().toISOString();
    const candidatas = await vendasNaoConfirmadas();
    if (candidatas.length > MAX_VENDAS_LOCAIS) {
      throw new Error("Há vendas demais aguardando envio para conciliar o estoque; elas serão enviadas e a sincronização tentará de novo.");
    }
    const pagina = await buscarPaginaCatalogoAction({
      entidade: "estoque",
      desde: p.desde,
      ate: p.ate,
      apos,
      tamanho: TAMANHO_PAGINA_CATALOGO,
      vendas_locais: candidatas.length ? candidatas : undefined,
    });
    conferirPagina(p, apos, pagina);
    const proximo = avancar(p, "estoque", pagina);
    if (await aplicarPaginaEstoque(pagina, candidatas, inicio, trava, proximo)) return proximo;
  }
  throw new Error("Vendas sendo registradas durante a sincronização do estoque; tentará de novo.");
}

function conferirPagina(p: Progresso, apos: CursorPagina | null, pagina: PaginaCatalogo) {
  if (p.ate && pagina.ate !== p.ate) throw new Error("Resposta de sincronização inconsistente (janela alterada).");
  if (pagina.proximo && apos && pagina.proximo.id === apos.id && pagina.proximo.t === apos.t) {
    throw new Error("Sincronização sem progresso (cursor repetido); tentará de novo.");
  }
}

/**
 * Uma rodada completa e RETOMÁVEL: lê cada entidade em páginas, grava cada página e o progresso numa única
 * transação local (que também confere a licença da aba), e só no fim avança o cursor global.
 */
async function executarRodada(trava: Trava): Promise<Contagens> {
  let p = (await lerProgresso()) ?? (await novoProgresso());

  for (const entidade of ENTIDADES_CATALOGO) {
    while (!p.concluidas.includes(entidade)) {
      const apos = p.cursores[entidade] ?? null;

      if (entidade === "estoque") {
        p = await paginaDeEstoque(p, apos, trava);
        continue;
      }

      const pagina = await buscarPaginaCatalogoAction({
        entidade,
        desde: p.desde,
        ate: p.ate,
        apos,
        tamanho: TAMANHO_PAGINA_CATALOGO,
      });
      conferirPagina(p, apos, pagina);
      const proximo = avancar(p, entidade, pagina);

      await aplicarAlteracoesCatalogoLocal(paginaComoAlteracoes(entidade, pagina), async () => {
        await trava.verificarERenovar();
        await getOfflineDB().configuracoes_local.put({ chave: CHAVE_PROGRESSO, valor: JSON.stringify(proximo) });
      });
      p = proximo;
    }
  }

  // Tudo gravado: só agora o cursor global avança e o progresso some — e nunca regride.
  const db = getOfflineDB();
  await db.transaction("rw", db.configuracoes_local, async () => {
    await trava.verificarERenovar();
    const novoCursor = (p.marca ?? p.ate) as string;
    const atual = (await db.configuracoes_local.get(CHAVE_CARIMBO))?.valor;
    if (!atual || Number.isNaN(Date.parse(atual)) || Date.parse(novoCursor) >= Date.parse(atual)) {
      await db.configuracoes_local.put({ chave: CHAVE_CARIMBO, valor: novoCursor });
    }
    await db.configuracoes_local.put({ chave: CHAVE_VERSAO, valor: VERSAO_PROTOCOLO });
    await db.configuracoes_local.delete(CHAVE_PROGRESSO);
  });
  return p.contagens;
}

let filaLocal: Promise<unknown> = Promise.resolve();

/**
 * Uma sincronização por vez, em três camadas:
 *  1. fila dentro da aba (quem chega durante uma rodada espera e roda a sua, curta);
 *  2. Web Locks entre abas, quando existe (também libera sozinho se a aba morrer);
 *  3. licença no IndexedDB com CERCA nas gravações (ver trava-sincronizacao.service.ts): vale em qualquer
 *     navegador, inclusive páginas HTTP da rede local sem Web Locks.
 */
function emExclusao<T>(fn: (trava: Trava) => Promise<T>): Promise<T> {
  const rodar = async (): Promise<T> => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    const comTrava = async (forcar: boolean) => {
      const trava = await adquirirTrava({ forcar });
      try {
        return await fn(trava);
      } finally {
        await trava.liberar();
      }
    };
    if (locks?.request) return locks.request("sincronizacao-catalogo", () => comTrava(true)) as Promise<T>;
    return comTrava(false);
  };
  const proxima = filaLocal.then(rodar, rodar);
  filaLocal = proxima.catch(() => undefined);
  return proxima;
}

export async function sincronizarCatalogo(): Promise<ResultadoSincronizacaoCatalogo> {
  return emExclusao(async (trava) => {
    const inicioMs = Date.now();
    await registrarEventoSincronizacao("inicio");

    try {
      const contagem = await executarRodada(trava);
      const total = contagem.produtos + contagem.categorias + contagem.estoque + contagem.funcionarios + contagem.clientes;

      // Canal separado: verificadores de PIN offline (só cargos que apenas vendem).
      await sincronizarCredenciaisPin();
      await definirConfiguracao(CHAVE_ULTIMA_QTD, String(total));

      await registrarEventoSincronizacao("fim", {
        registros_atualizados: total,
        duracao_ms: Date.now() - inicioMs,
      });

      return { sucesso: true, contagem };
    } catch (e) {
      const mensagem = (e as Error).message;
      await registrarEventoSincronizacao("erro", {
        detalhes: mensagem,
        duracao_ms: Date.now() - inicioMs,
      });
      return { sucesso: false, erro: mensagem };
    }
  });
}

export async function obterUltimaSincronizacao(): Promise<{
  timestamp: string | null;
  quantidade: number;
}> {
  const timestamp = (await obterConfiguracao(CHAVE_CARIMBO)) ?? null;
  const quantidadeStr = await obterConfiguracao(CHAVE_ULTIMA_QTD);
  return { timestamp, quantidade: quantidadeStr ? Number(quantidadeStr) : 0 };
}