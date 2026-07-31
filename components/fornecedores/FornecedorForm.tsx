"use client";

import { useState } from "react";
import { criarFornecedorAction } from "@/lib/produtos/fornecedores-actions";

export function FornecedorForm() {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    const resultado = await criarFornecedorAction({ nome, telefone });
    setSalvando(false);

    if (!resultado.sucesso) {
      setErro(resultado.erro ?? "Erro ao salvar.");
      return;
    }
    setNome("");
    setTelefone("");
  }

  return (
    <div className="flex flex-col gap-3 max-w-md">
      <input
        placeholder="Nome do fornecedor"
        className="h-12 px-3 border rounded-lg text-lg"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
      />
      <input
        placeholder="Telefone (opcional)"
        className="h-12 px-3 border rounded-lg text-lg"
        value={telefone}
        onChange={(e) => setTelefone(e.target.value)}
      />
      {erro && <p className="text-red-600 text-sm">{erro}</p>}
      <button
        onClick={salvar}
        disabled={salvando || nome.trim().length < 2}
        className="h-12 rounded-xl bg-slate-900 text-white font-semibold disabled:opacity-40"
      >
        {salvando ? "Salvando..." : "Adicionar fornecedor"}
      </button>
    </div>
  );
}
