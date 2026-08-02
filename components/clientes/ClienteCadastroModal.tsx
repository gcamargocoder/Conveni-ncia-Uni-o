"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ClienteForm } from "./ClienteForm";

export function ClienteCadastroModal() {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <Plus className="w-4 h-4" />
        Novo Cliente
      </Button>

      <Modal aberto={aberto} titulo="Novo cliente" onFechar={() => setAberto(false)}>
        <ClienteForm onSucesso={() => setAberto(false)} />
      </Modal>
    </>
  );
}