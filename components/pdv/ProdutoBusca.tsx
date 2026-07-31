"use client";

import { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { ProdutoParaVenda } from "@/types/venda";
import { buscarProdutosLocalPorTermo, contarProdutosLocal } from "@/services/offline/produtos-local.service";
import { Alert } from "@/components/ui/Alert";

const DEBOUNCE_MS = 100; // local é rápido — o debounce aqui é só suavidade de UX, não necessidade de performance

interface ProdutoBuscaProps {
  onSelecionar: (produto: ProdutoParaVenda) => void;
}

/**
 * Busca 100% local (IndexedDB) — regra da Fase 2 do Offline First.
 * O PDV nunca consulta o Supabase diretamente para pesquisar produtos,
 * mesmo com internet disponível. A internet só mantém o banco local
 * atualizado (ver services/offline/sincronizacao-catalogo.service.ts).
 */
export function ProdutoBusca({ onSelecionar }: ProdutoBuscaProps) {
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<ProdutoParaVenda[]>([]);
  const [catalogoVazio, setCatalogoVazio] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    contarProdutosLocal().then((qtd) => setCatalogoVazio(qtd === 0));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (busca.trim().length === 0) {
      setResultados([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const produtos = await buscarProdutosLocalPorTermo(busca);
      setResultados(
        produtos.map((p) => ({
          produto_id: p.id,
          nome: p.nome,
          preco_unitario: p.preco_venda,
          codigo_barras: p.codigo_barras,
        }))
      );
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [busca]);

  function selecionar(p: ProdutoParaVenda) {
    onSelecionar(p);
    setBusca("");
    setResultados([]);
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          autoFocus
          placeholder="Buscar produto ou passar código de barras..."
          className="w-full h-14 pl-12 pr-4 text-lg rounded-xl border border-slate-300 focus:border-brand-600"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && resultados.length === 1) {
              selecionar(resultados[0]);
            }
          }}
        />
      </div>

      {catalogoVazio && (
        <Alert variante="warning" className="mt-2">
          Catálogo ainda sincronizando — se acabou de abrir o sistema, aguarde alguns segundos.
        </Alert>
      )}

      {resultados.length > 0 && (
        <ul className="absolute z-10 w-full bg-white border border-slate-200 rounded-xl mt-1 shadow-elevated max-h-64 overflow-auto">
          {resultados.map((p) => (
            <li key={p.produto_id}>
              <button
                onClick={() => selecionar(p)}
                className="w-full text-left px-4 py-3 hover:bg-slate-50 text-base flex justify-between transition-colors"
              >
                <span className="text-slate-800">{p.nome}</span>
                <span className="text-slate-500 font-medium">R$ {p.preco_unitario.toFixed(2)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}