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
    return <EmptyState icone={ShoppingCart} modulo="pdv" titulo="Carrinho vazio" descricao="Busque um produto para começar a venda." />;
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
              className="group w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 hover:-translate-y-0.5 hover:shadow-lg hover:ring-2 hover:ring-brand-200 flex items-center justify-center transition-all duration-300"
            >
              <Minus className="w-3.5 h-3.5 text-rose-500 transition-transform duration-300 group-hover:scale-110" />
            </button>
            <span className="w-6 text-center text-sm font-semibold tabular-nums">{item.quantidade}</span>
            <button
              onClick={() => onAlterarQuantidade(item.produto_id, item.quantidade + 1)}
              aria-label="Aumentar quantidade"
              className="group w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 hover:-translate-y-0.5 hover:shadow-lg hover:ring-2 hover:ring-brand-200 flex items-center justify-center transition-all duration-300"
            >
              <Plus className="w-3.5 h-3.5 text-teal-500 transition-transform duration-300 group-hover:scale-110" />
            </button>
          </div>

          <p className="w-20 text-right font-semibold text-slate-900 tabular-nums shrink-0">
            R$ {(item.preco_unitario * item.quantidade).toFixed(2)}
          </p>

          <button
            onClick={() => onRemover(item.produto_id)}
            aria-label={`Remover ${item.nome}`}
            className="group shrink-0 w-8 h-8 rounded-full bg-rose-50 ring-1 ring-rose-100 flex items-center justify-center transition-all duration-300 hover:bg-rose-100 hover:ring-rose-200 hover:-translate-y-0.5 hover:shadow-lg"
          >
            <Trash2 className="w-4 h-4 text-rose-500 transition-transform duration-300 group-hover:scale-110" />
          </button>
        </li>
      ))}
    </ul>
  );
}