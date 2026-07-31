export interface ItemCarrinho {
  produto_id: string;
  nome: string;
  preco_unitario: number;
  quantidade: number;
}

export function adicionarItem(
  carrinho: ItemCarrinho[],
  produto: { produto_id: string; nome: string; preco_unitario: number },
  quantidade = 1
): ItemCarrinho[] {
  const existente = carrinho.find((i) => i.produto_id === produto.produto_id);

  if (existente) {
    return carrinho.map((i) =>
      i.produto_id === produto.produto_id ? { ...i, quantidade: i.quantidade + quantidade } : i
    );
  }

  return [...carrinho, { ...produto, quantidade }];
}

export function removerItem(carrinho: ItemCarrinho[], produtoId: string): ItemCarrinho[] {
  return carrinho.filter((i) => i.produto_id !== produtoId);
}

export function alterarQuantidade(
  carrinho: ItemCarrinho[],
  produtoId: string,
  quantidade: number
): ItemCarrinho[] {
  if (quantidade <= 0) return removerItem(carrinho, produtoId);
  return carrinho.map((i) => (i.produto_id === produtoId ? { ...i, quantidade } : i));
}

export function calcularTotal(carrinho: ItemCarrinho[]): number {
  return carrinho.reduce((soma, item) => soma + item.preco_unitario * item.quantidade, 0);
}
