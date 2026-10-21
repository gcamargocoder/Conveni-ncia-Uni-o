"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ProdutoForm } from "./ProdutoForm";
import type { Produto } from "@/types/produto";
import { BotaoAcaoTabela } from "@/components/ui/BotaoAcaoTabela";

interface ProdutoEditarModalProps {
  produto: Produto;
  categorias: { id: string; nome: string }[];
  fornecedores: { id: string; nome: string }[];
}

export function ProdutoEditarModal({ produto, categorias, fornecedores }: ProdutoEditarModalProps) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <BotaoAcaoTabela tipo="editar" icone={Pencil} onClick={() => setAberto(true)}>
        Editar
      </BotaoAcaoTabela>

      <Modal aberto={aberto} titulo={`Editar — ${produto.nome}`} onFechar={() => setAberto(false)}>
        <ProdutoForm
          categorias={categorias}
          fornecedores={fornecedores}
          produtoId={produto.id}
          dadosIniciais={{
            nome: produto.nome,
            categoria_id: produto.categoria_id,
            fornecedor_id: produto.fornecedor_id,
            preco_venda: produto.preco_venda,
            preco_custo: produto.preco_custo,
            estoque_minimo: produto.estoque_minimo,
            codigo_barras: produto.codigo_barras,
            unidade: produto.unidade,
            descricao: produto.descricao,
            ativo: produto.ativo,
          }}
          onSucesso={() => setAberto(false)}
        />
      </Modal>
    </>
  );
}