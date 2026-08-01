"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { Search, Camera } from "lucide-react";
import { ProdutoParaVenda } from "@/types/venda";
import { buscarProdutosLocalPorTermo, contarProdutosLocal } from "@/services/offline/produtos-local.service";
import { Alert } from "@/components/ui/Alert";

const LeitorCameraModal = dynamic(
  () => import("@/components/ui/LeitorCameraModal").then((m) => m.LeitorCameraModal),
  { ssr: false }
);

const DEBOUNCE_MS = 100;

interface ProdutoBuscaProps {
  onSelecionar: (produto: ProdutoParaVenda) => void;
}

export function ProdutoBusca({ onSelecionar }: ProdutoBuscaProps) {
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<ProdutoParaVenda[]>([]);
  const [catalogoVazio, setCatalogoVazio] = useState(false);
  const [leitorCameraAberto, setLeitorCameraAberto] = useState(false);
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

  async function buscarESelecionarSeUnico(termo: string) {
    const termoLimpo = termo.trim();
    if (!termoLimpo) return;

    const encontrados = await buscarProdutosLocalPorTermo(termoLimpo);
    const mapeados = encontrados.map((p) => ({
      produto_id: p.id,
      nome: p.nome,
      preco_unitario: p.preco_venda,
      codigo_barras: p.codigo_barras,
    }));

    if (mapeados.length === 1) {
      selecionar(mapeados[0]);
    } else {
      setResultados(mapeados);
    }
  }

  async function aoApertarEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await buscarESelecionarSeUnico(busca);
  }

  function aoLerCodigoPelaCamera(codigo: string) {
    setLeitorCameraAberto(false);
    buscarESelecionarSeUnico(codigo);
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          autoFocus
          placeholder="Buscar produto ou passar código de barras..."
          className="w-full h-14 pl-12 pr-14 text-lg rounded-xl border border-slate-300 focus:border-brand-600"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={aoApertarEnter}
        />
        <button
          type="button"
          onClick={() => setLeitorCameraAberto(true)}
          aria-label="Escanear código de barras com a câmera"
          className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
        >
          <Camera className="w-5 h-5 text-slate-600" />
        </button>
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

      {leitorCameraAberto && (
        <LeitorCameraModal
          aberto={leitorCameraAberto}
          onFechar={() => setLeitorCameraAberto(false)}
          onCodigoLido={aoLerCodigoPelaCamera}
        />
      )}
    </div>
  );
}