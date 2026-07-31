import { getOfflineDB, ProdutoLocal } from "./db";

/**
 * Espelho local de produtos. Nesta etapa, só a estrutura de leitura/
 * escrita existe — quem vai popular isso (sincronização "para baixo")
 * é uma etapa futura.
 */

/**
 * Busca usada pelo PDV — 100% local, nunca toca o Supabase (regra da
 * Fase 2). Varre o espelho local em memória: com um catálogo de
 * milhares de produtos isso ainda é rápido (poucos milissegundos),
 * então não há necessidade de nenhuma indexação além da que o Dexie
 * já oferece nativamente por chave.
 *
 * Busca por nome (substring, sem diferenciar maiúsculas/minúsculas) e
 * por código de barras (exato — é o que o leitor de código de barras
 * "digita"). Não existe hoje um campo de "código" interno separado do
 * código de barras no cadastro de produto — se um dia existir, esta
 * função é o único lugar que precisaria mudar.
 */
export async function buscarProdutosLocalPorTermo(
  termo: string,
  limite = 8
): Promise<ProdutoLocal[]> {
  const termoNormalizado = termo.trim().toLowerCase();
  if (!termoNormalizado) return [];

  const db = getOfflineDB();
  const todos = await db.produtos_local.toArray();

  return todos
    .filter(
      (p) =>
        p.ativo &&
        (p.nome.toLowerCase().includes(termoNormalizado) || p.codigo_barras === termo.trim())
    )
    .slice(0, limite);
}

export async function contarProdutosLocal(): Promise<number> {
  const db = getOfflineDB();
  return db.produtos_local.count();
}

export async function listarProdutosLocal(): Promise<ProdutoLocal[]> {
  const db = getOfflineDB();
  const todos = await db.produtos_local.toArray();
  return todos.filter((p) => p.ativo).sort((a, b) => a.nome.localeCompare(b.nome));
}

export async function buscarProdutoLocalPorCodigoBarras(
  codigo: string
): Promise<ProdutoLocal | undefined> {
  const db = getOfflineDB();
  return db.produtos_local.where("codigo_barras").equals(codigo).first();
}

export async function substituirCatalogoLocal(produtos: ProdutoLocal[]): Promise<void> {
  const db = getOfflineDB();
  await db.produtos_local.bulkPut(produtos);
}
