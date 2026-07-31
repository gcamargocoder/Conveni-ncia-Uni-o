"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FornecedorForm } from "./FornecedorForm";

export function FornecedorCadastroModal() {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <Plus className="w-4 h-4" />
        Cadastrar fornecedor
      </Button>

      <Modal aberto={aberto} titulo="Novo fornecedor" onFechar={() => setAberto(false)}>
        <FornecedorForm onSucesso={() => setAberto(false)} />
      </Modal>
    </>
  );
}