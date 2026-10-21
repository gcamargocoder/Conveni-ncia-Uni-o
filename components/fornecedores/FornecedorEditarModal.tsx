"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { FornecedorForm } from "./FornecedorForm";
import type { Fornecedor } from "@/services/fornecedores.service";
import { BotaoAcaoTabela } from "@/components/ui/BotaoAcaoTabela";

interface FornecedorEditarModalProps {
  fornecedor: Fornecedor;
}

export function FornecedorEditarModal({ fornecedor }: FornecedorEditarModalProps) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <BotaoAcaoTabela tipo="editar" icone={Pencil} onClick={() => setAberto(true)}>
        Editar
      </BotaoAcaoTabela>

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