import { getOfflineDB, ItemCarrinhoLocal } from "./db";
import { ItemCarrinho } from "@/lib/vendas/carrinho";

/**
 * O carrinho vive no IndexedDB, não só no state do React — por isso
 * sobrevive a F5, fechamento inesperado ou queda de energia (requisito
 * 4/5 da Fase 3). Cada chamada substitui o conteúdo inteiro da tabela
 * pelo estado atual do carrinho — simples e correto para um carrinho
 * de poucas dezenas de itens; não precisa de diffing.
 */

export async function salvarCarrinhoLocal(itens: ItemCarrinho[]): Promise<void> {
  const db = getOfflineDB();
  const agora = new Date().toISOString();
  const registros: ItemCarrinhoLocal[] = itens.map((i) => ({
    produto_id: i.produto_id,
    nome: i.nome,
    preco_unitario: i.preco_unitario,
    quantidade: i.quantidade,
    atualizado_em: agora,
  }));

  await db.transaction("rw", db.carrinho_local, async () => {
    await db.carrinho_local.clear();
    if (registros.length) await db.carrinho_local.bulkPut(registros);
  });
}

export async function carregarCarrinhoLocal(): Promise<ItemCarrinho[]> {
  const db = getOfflineDB();
  const registros = await db.carrinho_local.toArray();
  return registros.map((r) => ({
    produto_id: r.produto_id,
    nome: r.nome,
    preco_unitario: r.preco_unitario,
    quantidade: r.quantidade,
  }));
}

/** Cancelamento explícito do carrinho pelo operador — único jeito de esvaziar sem concluir a venda. */
export async function limparCarrinhoLocal(): Promise<void> {
  const db = getOfflineDB();
  await db.carrinho_local.clear();
}
