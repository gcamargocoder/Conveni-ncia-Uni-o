"use client";

import { Minus, Plus, Trash2, ShoppingCart } from "lucide-react";
import { ItemCarrinho } from "@/lib/vendas/carrinho";
import { EmptyState } from "@/components/ui/EmptyState";

interface CarrinhoViewProps {
  itens: ItemCarrinho[];
  onAlterarQuantidade: (produtoId: string, quantidade: number) => void;
  onRemover: (produtoId: string) => void;
}

export function CarrinhoView({ itens, onAlterarQuantidade, onRemover }: CarrinhoViewProps) {
  if (itens.length === 0) {
    return <EmptyState icone={ShoppingCart} titulo="Carrinho vazio" descricao="Busque um produto para começar a venda." />;
  }

  return (
    <ul className="flex flex-col divide-y divide-slate-100">
      {itens.map((item) => (
        <li key={item.produto_id} className="flex items-center gap-3 py-3 px-1">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-slate-900 truncate">{item.nome}</p>
            <p className="text-slate-500 text-sm">R$ {item.preco_unitario.toFixed(2)} / un</p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onAlterarQuantidade(item.produto_id, item.quantidade - 1)}
              aria-label="Diminuir quantidade"
              className="w-8 h-8 rounded-md bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
            >
              <Minus className="w-3.5 h-3.5 text-slate-600" />
            </button>
            <span className="w-6 text-center text-sm font-semibold tabular-nums">{item.quantidade}</span>
            <button
              onClick={() => onAlterarQuantidade(item.produto_id, item.quantidade + 1)}
              aria-label="Aumentar quantidade"
              className="w-8 h-8 rounded-md bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-slate-600" />
            </button>
          </div>

          <p className="w-20 text-right font-semibold text-slate-900 tabular-nums shrink-0">
            R$ {(item.preco_unitario * item.quantidade).toFixed(2)}
          </p>

          <button
            onClick={() => onRemover(item.produto_id)}
            aria-label={`Remover ${item.nome}`}
            className="text-slate-400 hover:text-danger-600 transition-colors shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}