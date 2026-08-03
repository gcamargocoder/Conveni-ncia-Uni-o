"use client";

import { useState } from "react";
import { Search, Tags } from "lucide-react";
import { Table } from "@/components/ui/Table";
import { CategoriaEditarModal } from "./CategoriaEditarModal";
import type { Categoria } from "@/services/categorias.service";

interface ListaCategoriasProps {
  categorias: Categoria[];
}

export function ListaCategorias({ categorias }: ListaCategoriasProps) {
  const [busca, setBusca] = useState("");

  const termo = busca.trim().toLowerCase();
  const filtrado = termo ? categorias.filter((c) => c.nome.toLowerCase().includes(termo)) : categorias;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative px-5 pt-5">
        <Search className="absolute left-8 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          placeholder="Procurar categoria..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full h-11 pl-10 pr-3 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600"
        />
      </div>

      <Table
        colunas={[
          { chave: "nome", cabecalho: "Nome" },
          {
            chave: "acoes",
            cabecalho: "",
            render: (c) => <CategoriaEditarModal categoria={c} />,
          },
        ]}
        dados={filtrado}
        chaveLinha={(c) => c.id}
        vazioIcone={Tags}
        vazioTitulo={termo ? "Nenhuma categoria encontrada" : "Nenhuma categoria cadastrada ainda"}
        vazioDescricao={termo ? undefined : 'Categorias novas podem ser criadas direto no cadastro de produto.'}
      />
    </div>
  );
}