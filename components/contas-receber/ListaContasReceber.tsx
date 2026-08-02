"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { DetalheContaModal } from "./DetalheContaModal";
import type { ContaReceberComCliente } from "@/types/conta-receber";

const FILTROS = [
  { valor: "", rotulo: "Todas" },
  { valor: "ABERTA", rotulo: "Em aberto" },
  { valor: "PARCIAL", rotulo: "Parciais" },
  { valor: "QUITADA", rotulo: "Quitadas" },
];

const ROTULOS_STATUS: Record<string, { texto: string; variante: "warning" | "success" | "neutral" }> = {
  ABERTA: { texto: "Em aberto", variante: "warning" },
  PARCIAL: { texto: "Parcial", variante: "warning" },
  QUITADA: { texto: "Quitada", variante: "success" },
};

interface ListaContasReceberProps {
  contas: ContaReceberComCliente[];
  statusAtual: string;
}

export function ListaContasReceber({ contas, statusAtual }: ListaContasReceberProps) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [contaAberta, setContaAberta] = useState<string | null>(null);

  const termo = busca.trim().toLowerCase();
  const filtrado = termo ? contas.filter((c) => c.cliente_nome.toLowerCase().includes(termo)) : contas;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5 px-5 pt-5">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            onClick={() => router.push(f.valor ? `/contas-receber?status=${f.valor}` : "/contas-receber")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusAtual === f.valor ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      <div className="relative px-5">
        <Search className="absolute left-8 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          placeholder="Procurar por cliente..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full h-11 pl-10 pr-3 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600"
        />
      </div>

      <Table
        colunas={[
          { chave: "cliente_nome", cabecalho: "Cliente" },
          {
            chave: "valor_original",
            cabecalho: "Valor original",
            render: (c) => `R$ ${c.valor_original.toFixed(2)}`,
          },
          {
            chave: "saldo_atual",
            cabecalho: "Saldo atual",
            render: (c) => (
              <span className="font-semibold text-slate-900 tabular-nums">R$ {c.saldo_atual.toFixed(2)}</span>
            ),
          },
          {
            chave: "status",
            cabecalho: "Situação",
            render: (c) => (
              <Badge variante={ROTULOS_STATUS[c.status].variante}>{ROTULOS_STATUS[c.status].texto}</Badge>
            ),
          },
          {
            chave: "venda_created_at",
            cabecalho: "Data da compra",
            render: (c) => new Date(c.venda_created_at).toLocaleDateString("pt-BR"),
          },
          {
            chave: "acoes",
            cabecalho: "",
            render: (c) => (
              <button
                onClick={() => setContaAberta(c.id)}
                className="text-brand-700 hover:underline text-sm font-medium"
              >
                Ver detalhes
              </button>
            ),
          },
        ]}
        dados={filtrado}
        chaveLinha={(c) => c.id}
        vazioIcone={Receipt}
        vazioTitulo={termo ? "Nenhuma conta encontrada" : "Nenhuma conta a receber"}
      />

      <DetalheContaModal contaId={contaAberta} onFechar={() => setContaAberta(null)} />
    </div>
  );
}