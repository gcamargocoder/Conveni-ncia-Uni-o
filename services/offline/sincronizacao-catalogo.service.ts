import { getOfflineDB, ProdutoLocal, CategoriaLocal, EstoqueLocal } from "./db";
import { obterConfiguracao, definirConfiguracao } from "./configuracao-local.service";
import { registrarEventoSincronizacao } from "./auditoria-sincronizacao.service";
import { buscarAlteracoesCatalogoAction, AlteracoesCatalogo } from "@/lib/offline-sync/actions";

const CHAVE_CARIMBO = "ultima_sincronizacao_catalogo";
const CHAVE_ULTIMA_QTD = "ultima_qtd_produtos_sincronizados";

export interface ContagemSincronizacao {
  produtos: number;
  categorias: number;
  estoque: number;
}

/**
 * Aplica alterações já buscadas do servidor ao banco local. Separada
 * de sincronizarCatalogo() de propósito: esta função não faz nenhuma
 * chamada de rede, então é totalmente testável (dado um payload
 * fabricado, sem precisar mockar Server Action nem Supabase) — os
 * testes desta etapa cobrem justamente esta função.
 *
 * Um produto que veio desativado/excluído do servidor (ativo=false ou
 * deleted_at preenchido) é gravado localmente com ativo=false — nunca
 * removido fisicamente do IndexedDB. Isso é suficiente: toda leitura
 * local (buscarProdutosLocalPorTermo, listarProdutosLocal) já filtra
 * por ativo, então o produto simplesmente para de aparecer nas buscas,
 * sem precisar de nenhum caminho de código especial para "remoção".
 */
export async function aplicarAlteracoesCatalogoLocal(
  alteracoes: AlteracoesCatalogo
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

  await db.transaction(
    "rw",
    db.produtos_local,
    db.categorias_local,
    db.estoque_local,
    async () => {
      if (produtosLocal.length) await db.produtos_local.bulkPut(produtosLocal);
      if (categoriasLocal.length) await db.categorias_local.bulkPut(categoriasLocal);
      if (estoqueLocal.length) await db.estoque_local.bulkPut(estoqueLocal);
    }
  );

  return {
    produtos: produtosLocal.length,
    categorias: categoriasLocal.length,
    estoque: estoqueLocal.length,
  };
}

export interface ResultadoSincronizacaoCatalogo {
  sucesso: boolean;
  contagem?: ContagemSincronizacao;
  erro?: string;
}

/**
 * Ponto de entrada real, chamado pela UI. Busca no servidor (rede) e
 * delega a aplicação local para aplicarAlteracoesCatalogoLocal(). O
 * carimbo só avança DEPOIS da gravação local ter sucesso — se cair no
 * meio, a próxima sincronização repete a mesma janela (idempotente).
 */
export async function sincronizarCatalogo(): Promise<ResultadoSincronizacaoCatalogo> {
  const inicioMs = Date.now();
  await registrarEventoSincronizacao("inicio");

  try {
    const carimboAnterior = await obterConfiguracao(CHAVE_CARIMBO);
    const alteracoes = await buscarAlteracoesCatalogoAction(carimboAnterior ?? null);
    const contagem = await aplicarAlteracoesCatalogoLocal(alteracoes);

    await definirConfiguracao(CHAVE_CARIMBO, alteracoes.timestampServidor);
    await definirConfiguracao(
      CHAVE_ULTIMA_QTD,
      String(contagem.produtos + contagem.categorias + contagem.estoque)
    );

    await registrarEventoSincronizacao("fim", {
      registros_atualizados: contagem.produtos + contagem.categorias + contagem.estoque,
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
}

export async function obterUltimaSincronizacao(): Promise<{
  timestamp: string | null;
  quantidade: number;
}> {
  const timestamp = (await obterConfiguracao(CHAVE_CARIMBO)) ?? null;
  const quantidadeStr = await obterConfiguracao(CHAVE_ULTIMA_QTD);
  return { timestamp, quantidade: quantidadeStr ? Number(quantidadeStr) : 0 };
}
