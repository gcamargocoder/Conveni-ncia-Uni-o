"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ProdutoForm } from "./ProdutoForm";

interface ProdutoCadastroModalProps {
  categorias: { id: string; nome: string }[];
  fornecedores: { id: string; nome: string }[];
}

export function ProdutoCadastroModal({ categorias, fornecedores }: ProdutoCadastroModalProps) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <Plus className="w-4 h-4" />
        Cadastrar produto
      </Button>

      <Modal aberto={aberto} titulo="Novo produto" onFechar={() => setAberto(false)}>
        <ProdutoForm categorias={categorias} fornecedores={fornecedores} onSucesso={() => setAberto(false)} />
      </Modal>
    </>
  );
}