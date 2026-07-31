"use client";

import { useState } from "react";
import { Search, Boxes } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { ProdutoEstoqueModal } from "./ProdutoEstoqueModal";
import type { EstoqueAtual } from "@/services/estoque.service";

interface ListaEstoqueProps {
  estoque: EstoqueAtual[];
}

export function ListaEstoque({ estoque }: ListaEstoqueProps) {
  const [busca, setBusca] = useState("");

  const termo = busca.trim().toLowerCase();
  const filtrado = termo ? estoque.filter((e) => e.nome.toLowerCase().includes(termo)) : estoque;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative px-5 pt-5">
        <Search className="absolute left-8 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          placeholder="Procurar produto..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full h-11 pl-10 pr-3 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600"
        />
      </div>

      <Table
        colunas={[
          { chave: "nome", cabecalho: "Produto" },
          {
            chave: "quantidade_atual",
            cabecalho: "Quantidade",
            render: (e) => (
              <span className="text-base font-semibold text-slate-900 tabular-nums">{e.quantidade_atual}</span>
            ),
          },
          {
            chave: "alerta",
            cabecalho: "Situação",
            render: (e) =>
              e.quantidade_atual < e.estoque_minimo ? (
                <Badge variante="warning">Estoque baixo (mín: {e.estoque_minimo})</Badge>
              ) : (
                <span className="text-slate-400 text-xs">OK</span>
              ),
          },
          {
            chave: "acoes",
            cabecalho: "",
            render: (e) => <ProdutoEstoqueModal produtoId={e.produto_id} produtoNome={e.nome} />,
          },
        ]}
        dados={filtrado}
        chaveLinha={(e) => e.produto_id}
        vazioIcone={Boxes}
        vazioTitulo={termo ? "Nenhum produto encontrado" : "Nenhum produto no estoque ainda"}
      />
    </div>
  );
}