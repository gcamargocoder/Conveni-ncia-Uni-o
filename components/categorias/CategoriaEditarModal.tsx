"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { useToast } from "@/components/ui/ToastProvider";
import { atualizarCategoriaAction, excluirCategoriaAction } from "@/lib/produtos/categorias-actions";
import type { Categoria } from "@/services/categorias.service";

interface CategoriaEditarModalProps {
  categoria: Categoria;
}

export function CategoriaEditarModal({ categoria }: CategoriaEditarModalProps) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(categoria.nome);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [pedindoConfirmacaoExcluir, setPedindoConfirmacaoExcluir] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const { mostrar } = useToast();

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    setErro(null);

    const resultado = await atualizarCategoriaAction(categoria.id, nome);
    setSalvando(false);

    if (!resultado.sucesso) {
      setErro(resultado.erro ?? "Erro ao salvar.");
      return;
    }
    mostrar("success", "Categoria atualizada.");
    setAberto(false);
  }

  async function confirmarExcluir() {
    setExcluindo(true);
    const resultado = await excluirCategoriaAction(categoria.id);
    setExcluindo(false);
    setPedindoConfirmacaoExcluir(false);

    if (!resultado.sucesso) {
      mostrar("danger", resultado.erro ?? "Erro ao excluir categoria.");
      return;
    }
    mostrar("success", "Categoria excluída.");
    setAberto(false);
  }

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="flex items-center gap-1.5 text-brand-700 hover:underline text-sm font-medium"
      >
        <Pencil className="w-3.5 h-3.5" />
        Editar
      </button>

      <Modal aberto={aberto} titulo={`Editar — ${categoria.nome}`} onFechar={() => setAberto(false)}>
        <div className="flex flex-col gap-4">
          <Input rotulo="Nome" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} />

          {erro && <Alert variante="danger">{erro}</Alert>}

          <Button onClick={salvar} carregando={salvando} disabled={salvando || nome.trim().length < 2}>
            Salvar alterações
          </Button>

          <div className="border-t border-slate-100 pt-4">
            <Button variante="danger" tamanho="sm" onClick={() => setPedindoConfirmacaoExcluir(true)}>
              Excluir categoria
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        aberto={pedindoConfirmacaoExcluir}
        titulo="Excluir categoria"
        onFechar={() => setPedindoConfirmacaoExcluir(false)}
        rodape={
          <>
            <Button variante="secondary" tamanho="sm" onClick={() => setPedindoConfirmacaoExcluir(false)}>
              Voltar
            </Button>
            <Button variante="danger" tamanho="sm" onClick={confirmarExcluir} carregando={excluindo}>
              Confirmar exclusão
            </Button>
          </>
        }
      >
        <p>
          A categoria <strong>{categoria.nome}</strong> será apagada de vez — isso não pode ser desfeito.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Só é possível excluir categorias sem nenhum produto vinculado. Se algum produto já usa essa categoria, a
          exclusão será recusada — mude a categoria desses produtos primeiro.
        </p>
      </Modal>
    </>
  );
}