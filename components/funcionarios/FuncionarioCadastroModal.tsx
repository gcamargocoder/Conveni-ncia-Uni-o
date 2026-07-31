"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FuncionarioForm } from "./FuncionarioForm";

export function FuncionarioCadastroModal() {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <Plus className="w-4 h-4" />
        Cadastrar funcionário
      </Button>

      <Modal aberto={aberto} titulo="Novo funcionário" onFechar={() => setAberto(false)}>
        <FuncionarioForm onSucesso={() => setAberto(false)} />
      </Modal>
    </>
  );
}