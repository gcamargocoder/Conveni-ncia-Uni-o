"use client";

import { useState } from "react";
import { Search, Boxes, Printer } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { ProdutoEstoqueModal } from "./ProdutoEstoqueModal";
import { ImpressaoEstoque } from "./ImpressaoEstoque";
import type { EstoqueAtual } from "@/services/estoque.service";

interface ListaEstoqueProps {
  estoque: EstoqueAtual[];
}

export function ListaEstoque({ estoque }: ListaEstoqueProps) {
  const [busca, setBusca] = useState("");

  const termo = busca.trim().toLowerCase();
  const filtrado = termo ? estoque.filter((e) => e.nome.toLowerCase().includes(termo)) : estoque;

  function imprimir() {
    window.print();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-col sm:flex-row sm:items-center gap-3 px-5 pt-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            placeholder="Procurar produto..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full h-11 pl-10 pr-3 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600"
          />
        </div>
        <Button variante="secondary" tamanho="sm" onClick={imprimir}>
          <Printer className="w-3.5 h-3.5" />
          Imprimir Estoque
        </Button>
      </div>

      <div className="no-print">
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
              render: (e) => (
                <ProdutoEstoqueModal produtoId={e.produto_id} produtoNome={e.nome} estoqueMinimo={e.estoque_minimo} />
              ),
            },
          ]}
          dados={filtrado}
          chaveLinha={(e) => e.produto_id}
          vazioIcone={Boxes}
          vazioTitulo={termo ? "Nenhum produto encontrado" : "Nenhum produto no estoque ainda"}
        />
      </div>

      <ImpressaoEstoque itens={filtrado} />
    </div>
  );
}