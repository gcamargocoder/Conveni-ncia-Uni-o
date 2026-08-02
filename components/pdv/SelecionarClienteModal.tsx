"use client";

import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { buscarClientesLocalPorTermo } from "@/services/offline/clientes-local.service";
import type { ClienteLocal } from "@/services/offline/db";

interface SelecionarClienteModalProps {
  aberto: boolean;
  onFechar: () => void;
  onSelecionar: (cliente: ClienteLocal) => void;
}

export function SelecionarClienteModal({ aberto, onFechar, onSelecionar }: SelecionarClienteModalProps) {
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<ClienteLocal[]>([]);

  useEffect(() => {
    if (!aberto) {
      setBusca("");
      setResultados([]);
    }
  }, [aberto]);

  useEffect(() => {
    const termo = busca.trim();
    if (!termo) {
      setResultados([]);
      return;
    }
    const temporizador = setTimeout(async () => {
      const encontrados = await buscarClientesLocalPorTermo(termo);
      setResultados(encontrados);
    }, 150);
    return () => clearTimeout(temporizador);
  }, [busca]);

  return (
    <Modal aberto={aberto} titulo="Selecionar cliente" onFechar={onFechar}>
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            autoFocus
            placeholder="Buscar cliente pelo nome..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full h-11 pl-10 pr-3 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600"
          />
        </div>

        {busca.trim() && resultados.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-4">Nenhum cliente encontrado.</p>
        )}

        <ul className="flex flex-col divide-y divide-slate-50 max-h-64 overflow-auto">
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onSelecionar(c)}
                className="w-full text-left px-2 py-3 hover:bg-slate-50 transition-colors"
              >
                <p className="text-slate-800 font-medium">{c.nome}</p>
                {c.telefone && <p className="text-slate-500 text-xs">{c.telefone}</p>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}