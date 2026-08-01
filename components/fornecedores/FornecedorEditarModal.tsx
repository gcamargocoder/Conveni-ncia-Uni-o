"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FornecedorForm } from "./FornecedorForm";
import type { Fornecedor } from "@/services/fornecedores.service";

interface FornecedorEditarModalProps {
  fornecedor: Fornecedor;
}

export function FornecedorEditarModal({ fornecedor }: FornecedorEditarModalProps) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="flex items-center gap-1.5 text-brand-700 hover:underline text-sm font-medium"
      >
        <Pencil className="w-3.5 h-3.5" />
        Editar
      </button>

      <Modal aberto={aberto} titulo={`Editar — ${fornecedor.nome}`} onFechar={() => setAberto(false)}>
        <FornecedorForm
          fornecedorId={fornecedor.id}
          dadosIniciais={{
            nome: fornecedor.nome,
            razao_social: fornecedor.razao_social,
            cnpj_cpf: fornecedor.cnpj_cpf,
            telefone: fornecedor.telefone,
            whatsapp: fornecedor.whatsapp,
            email: fornecedor.email,
            endereco: fornecedor.endereco,
            cidade: fornecedor.cidade,
            estado: fornecedor.estado,
            observacoes: fornecedor.observacoes,
            ativo: fornecedor.ativo,
          }}
          onSucesso={() => setAberto(false)}
        />
      </Modal>
    </>
  );
}