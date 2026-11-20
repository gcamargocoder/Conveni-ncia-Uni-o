import { getOfflineDB, ProdutoLocal, CategoriaLocal, EstoqueLocal, FuncionarioLocal, ClienteLocal } from "./db";
import { obterConfiguracao, definirConfiguracao } from "./configuracao-local.service";
import { registrarEventoSincronizacao } from "./auditoria-sincronizacao.service";
import { buscarPaginaCatalogoAction, AlteracoesCatalogo } from "@/lib/offline-sync/actions";
import {
  ENTIDADES_CATALOGO,
  SOBREPOSICAO_MS,
  TAMANHO_PAGINA_CATALOGO,
  type CursorPagina,
  type EntidadeCatalogo,
  type PaginaCatalogo,
} from "@/lib/offline-sync/catalogo-paginas";
import { sincronizarCredenciaisPin } from "./credenciais-pin-local.service";

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
  /** Instante-limite fixado pelo servidor na primeira página; vira o cursor global ao concluir. */
  ate: string | null;
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
    return { ...p, contagens: { ...ZERO, ...p.contagens } };
  } catch {
    return null; // progresso ilegível: recomeça a rodada (idempotente), nunca trava
  }
}

async function novoProgresso(): Promise<Progresso> {
  const cursor = await obterConfiguracao(CHAVE_CARIMBO);
  const versao = await obterConfiguracao(CHAVE_VERSAO);
  let desde: string | null = null;
  if (cursor && versao === VERSAO_PROTOCOLO && !Number.isNaN(Date.parse(cursor))) {
    desde = new Date(Date.parse(cursor) - SOBREPOSICAO_MS).toISOString();
  }
  return { v: 1, desde, ate: null, cursores: {}, concluidas: [], contagens: { ...ZERO } };
}

function paginaComoAlteracoes(entidade: EntidadeCatalogo, pagina: PaginaCatalogo): AlteracoesCatalogo {
  const vazio = { produtos: [], categorias: [], estoque: [], funcionarios: [], clientes: [] };
  return { ...vazio, [entidade]: pagina.itens, timestampServidor: pagina.ate } as AlteracoesCatalogo;
}

/**
 * Uma rodada completa e RETOMÁVEL: lê cada entidade em páginas, grava cada página e o progresso numa única
 * transação local, e só no fim avança o cursor global. Se cair no meio (internet, aba fechada, erro numa página),
 * o progresso fica salvo e a próxima chamada continua da página seguinte, com a mesma janela.
 */
async function executarRodada(): Promise<Contagens> {
  let p = (await lerProgresso()) ?? (await novoProgresso());

  for (const entidade of ENTIDADES_CATALOGO) {
    while (!p.concluidas.includes(entidade)) {
      const apos = p.cursores[entidade] ?? null;
      const pagina = await buscarPaginaCatalogoAction({
        entidade,
        desde: p.desde,
        ate: p.ate,
        apos,
        tamanho: TAMANHO_PAGINA_CATALOGO,
      });
      if (p.ate && pagina.ate !== p.ate) throw new Error("Resposta de sincronização inconsistente (janela alterada).");
      if (pagina.proximo && apos && pagina.proximo.id === apos.id && pagina.proximo.t === apos.t) {
        throw new Error("Sincronização sem progresso (cursor repetido); tentará de novo.");
      }

      const proximo: Progresso = {
        ...p,
        ate: pagina.ate,
        cursores: { ...p.cursores },
        concluidas: [...p.concluidas],
        contagens: { ...p.contagens, [entidade]: p.contagens[entidade] + pagina.itens.length },
      };
      if (pagina.proximo) proximo.cursores[entidade] = pagina.proximo;
      else {
        delete proximo.cursores[entidade];
        proximo.concluidas.push(entidade);
      }

      await aplicarAlteracoesCatalogoLocal(paginaComoAlteracoes(entidade, pagina), async () => {
        await getOfflineDB().configuracoes_local.put({ chave: CHAVE_PROGRESSO, valor: JSON.stringify(proximo) });
      });
      p = proximo;
    }
  }

  // Tudo gravado: só agora o cursor global avança (para o instante-limite desta rodada) e o progresso some.
  const db = getOfflineDB();
  await db.transaction("rw", db.configuracoes_local, async () => {
    await db.configuracoes_local.put({ chave: CHAVE_CARIMBO, valor: p.ate as string });
    await db.configuracoes_local.put({ chave: CHAVE_VERSAO, valor: VERSAO_PROTOCOLO });
    await db.configuracoes_local.delete(CHAVE_PROGRESSO);
  });
  return p.contagens;
}

let filaLocal: Promise<unknown> = Promise.resolve();

/**
 * Uma sincronização por vez: entre abas (Web Locks) e dentro da aba (fila). Quem chega durante uma rodada ESPERA e
 * depois roda a sua (curta, incremental) — não pula, não corre em paralelo, não grava cursor fora de ordem.
 */
function emExclusao<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) return locks.request("sincronizacao-catalogo", fn) as Promise<T>;
  const proxima = filaLocal.then(fn, fn);
  filaLocal = proxima.catch(() => undefined);
  return proxima;
}

export async function sincronizarCatalogo(): Promise<ResultadoSincronizacaoCatalogo> {
  return emExclusao(async () => {
    const inicioMs = Date.now();
    await registrarEventoSincronizacao("inicio");

    try {
      const contagem = await executarRodada();
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