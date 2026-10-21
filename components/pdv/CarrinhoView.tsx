"use client";

import { Minus, Plus, Trash2, ShoppingCart } from "lucide-react";
import { ItemCarrinho } from "@/lib/vendas/carrinho";

interface CarrinhoViewProps {
  itens: ItemCarrinho[];
  onAlterarQuantidade: (produtoId: string, quantidade: number) => void;
  onRemover: (produtoId: string) => void;
}

export function CarrinhoView({ itens, onAlterarQuantidade, onRemover }: CarrinhoViewProps) {
  if (itens.length === 0) {
    // Mesmo conteúdo do EmptyState compartilhado, com as cores da tela de venda escura.
    return (
      <div className="flex flex-col items-center text-center py-12 px-4">
        <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
          <ShoppingCart className="w-6 h-6 text-brand-blue" />
        </div>
        <p className="font-medium text-zinc-200">Carrinho vazio</p>
        <p className="text-sm text-zinc-500 mt-1 max-w-xs">Busque um produto para começar a venda.</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-surface-border">
      {itens.map((item) => (
        <li key={item.produto_id} className="flex items-center gap-3 py-2.5 px-3 rounded-md even:bg-white/[0.03]">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-white truncate">{item.nome}</p>
            <p className="text-zinc-400 text-sm">R$ {item.preco_unitario.toFixed(2)} / un</p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onAlterarQuantidade(item.produto_id, item.quantidade - 1)}
              aria-label="Diminuir quantidade"
              className="w-8 h-8 rounded-md bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center transition-colors duration-150"
            >
              <Minus className="w-3.5 h-3.5 text-zinc-300" />
            </button>
            <span className="w-6 text-center text-sm font-semibold tabular-nums text-white">{item.quantidade}</span>
            <button
              onClick={() => onAlterarQuantidade(item.produto_id, item.quantidade + 1)}
              aria-label="Aumentar quantidade"
              className="w-8 h-8 rounded-md bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center transition-colors duration-150"
            >
              <Plus className="w-3.5 h-3.5 text-zinc-300" />
            </button>
          </div>

          <p className="w-20 text-right font-semibold text-white tabular-nums shrink-0">
            R$ {(item.preco_unitario * item.quantidade).toFixed(2)}
          </p>

          <button
            onClick={() => onRemover(item.produto_id)}
            aria-label={`Remover ${item.nome}`}
            className="text-zinc-500 hover:text-red-400 transition-colors duration-150 shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}
