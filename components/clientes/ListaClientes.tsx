"use client";

import { useState } from "react";
import { Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { ClienteEditarModal } from "./ClienteEditarModal";
import type { Cliente } from "@/types/cliente";

interface ListaClientesProps {
  clientes: Cliente[];
}

export function ListaClientes({ clientes }: ListaClientesProps) {
  const [busca, setBusca] = useState("");

  const termo = busca.trim().toLowerCase();
  const filtrado = termo ? clientes.filter((c) => c.nome.toLowerCase().includes(termo)) : clientes;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative px-5 pt-5">
        <Search className="absolute left-8 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          placeholder="Procurar cliente pelo nome..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full h-11 pl-10 pr-3 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600"
        />
      </div>

      <Table
        colunas={[
          { chave: "nome", cabecalho: "Nome" },
          { chave: "telefone", cabecalho: "Telefone", render: (c) => c.telefone ?? "—" },
          {
            chave: "situacao",
            cabecalho: "Situação",
            render: (c) =>
              c.ativo ? (
                <span className="text-slate-400 text-xs">Ativo</span>
              ) : (
                <Badge variante="neutral">Inativo</Badge>
              ),
          },
          {
            chave: "acoes",
            cabecalho: "",
            render: (c) => <ClienteEditarModal cliente={c} />,
          },
        ]}
        dados={filtrado}
        chaveLinha={(c) => c.id}
        vazioIcone={Users}
        vazioTitulo={termo ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado ainda"}
        vazioDescricao={termo ? undefined : 'Clique em "Novo Cliente" para começar.'}
      />
    </div>
  );
}