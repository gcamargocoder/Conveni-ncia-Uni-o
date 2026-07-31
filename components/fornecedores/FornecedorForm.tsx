"use client";

import { useState } from "react";
import { criarFornecedorAction } from "@/lib/produtos/fornecedores-actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";

export interface FornecedorFormProps {
  onSucesso?: () => void;
}

export function FornecedorForm({ onSucesso }: FornecedorFormProps) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const { mostrar } = useToast();

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
    mostrar("success", "Fornecedor adicionado.");
    onSucesso?.();
  }

  return (
    <div className="flex flex-col gap-4 max-w-md">
      <Input rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      <Input
        rotulo="Telefone (opcional)"
        value={telefone}
        onChange={(e) => setTelefone(e.target.value)}
      />
      {erro && <p className="text-danger-600 text-sm">{erro}</p>}
      <Button onClick={salvar} carregando={salvando} disabled={nome.trim().length < 2}>
        Adicionar fornecedor
      </Button>
    </div>
  );
}