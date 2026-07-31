"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/ToastProvider";
import { renomearProdutoAction, ajustarEstoqueMinimoAction } from "@/lib/produtos/actions";
import { MovimentacaoForm } from "./MovimentacaoForm";

interface ProdutoEstoqueModalProps {
  produtoId: string;
  produtoNome: string;
  estoqueMinimo: number;
}

export function ProdutoEstoqueModal({ produtoId, produtoNome, estoqueMinimo }: ProdutoEstoqueModalProps) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(produtoNome);
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [minimo, setMinimo] = useState(estoqueMinimo);
  const [salvandoMinimo, setSalvandoMinimo] = useState(false);
  const { mostrar } = useToast();

  async function salvarNome() {
    setSalvandoNome(true);
    const resultado = await renomearProdutoAction(produtoId, nome);
    setSalvandoNome(false);

    if (!resultado.sucesso) {
      mostrar("danger", resultado.erroGeral ?? resultado.erros?.[0]?.mensagem ?? "Erro ao renomear.");
      return;
    }
    mostrar("success", "Nome atualizado.");
  }

  async function salvarMinimo() {
    setSalvandoMinimo(true);
    const resultado = await ajustarEstoqueMinimoAction(produtoId, minimo);
    setSalvandoMinimo(false);

    if (!resultado.sucesso) {
      mostrar("danger", resultado.erroGeral ?? resultado.erros?.[0]?.mensagem ?? "Erro ao ajustar.");
      return;
    }
    mostrar("success", "Limiar de estoque baixo atualizado.");
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

      <Modal aberto={aberto} titulo={`Editar — ${produtoNome}`} onFechar={() => setAberto(false)}>
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Renomear produto
            </h3>
            <div className="flex gap-2 items-end">
              <Input value={nome} onChange={(e) => setNome(e.target.value)} className="flex-1" />
              <Button
                variante="secondary"
                onClick={salvarNome}
                carregando={salvandoNome}
                disabled={nome.trim().length < 2 || nome.trim() === produtoNome}
              >
                Salvar
              </Button>
            </div>
          </section>

          <div className="border-t border-slate-100" />

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Limiar de estoque baixo
            </h3>
            <p className="text-xs text-slate-500 -mt-1">
              Quando a quantidade cair abaixo deste número, aparece o aviso "Estoque baixo". Não é a
              quantidade que você tem — é só o limite do aviso.
            </p>
            <div className="flex gap-2 items-end">
              <Input
                type="number"
                value={minimo}
                onChange={(e) => setMinimo(Number(e.target.value))}
                className="flex-1"
              />
              <Button
                variante="secondary"
                onClick={salvarMinimo}
                carregando={salvandoMinimo}
                disabled={minimo < 0 || minimo === estoqueMinimo}
              >
                Salvar
              </Button>
            </div>
          </section>

          <div className="border-t border-slate-100" />

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Registrar movimentação de estoque
            </h3>
            <MovimentacaoForm
              produtos={[]}
              produtoFixo={{ id: produtoId, nome: produtoNome }}
              onSucesso={() => setAberto(false)}
            />
          </section>
        </div>
      </Modal>
    </>
  );
}