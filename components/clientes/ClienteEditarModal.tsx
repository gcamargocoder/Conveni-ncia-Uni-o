"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";
import { desativarClienteAction, excluirClienteAction } from "@/lib/clientes/actions";
import { ClienteForm } from "./ClienteForm";
import type { Cliente } from "@/types/cliente";

interface ClienteEditarModalProps {
  cliente: Cliente;
}

export function ClienteEditarModal({ cliente }: ClienteEditarModalProps) {
  const [aberto, setAberto] = useState(false);
  const [pedindoConfirmacaoDesativar, setPedindoConfirmacaoDesativar] = useState(false);
  const [pedindoConfirmacaoExcluir, setPedindoConfirmacaoExcluir] = useState(false);
  const [desativando, setDesativando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const { mostrar } = useToast();

  async function confirmarDesativar() {
    setDesativando(true);
    const resultado = await desativarClienteAction(cliente.id);
    setDesativando(false);
    setPedindoConfirmacaoDesativar(false);

    if (!resultado.sucesso) {
      mostrar("danger", resultado.erroGeral ?? "Erro ao desativar cliente.");
      return;
    }
    mostrar("success", "Cliente desativado.");
    setAberto(false);
  }

  async function confirmarExcluir() {
    setExcluindo(true);
    const resultado = await excluirClienteAction(cliente.id);
    setExcluindo(false);
    setPedindoConfirmacaoExcluir(false);

    if (!resultado.sucesso) {
      mostrar("danger", resultado.erroGeral ?? "Erro ao excluir cliente.");
      return;
    }
    mostrar("success", "Cliente excluído.");
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

      <Modal aberto={aberto} titulo={`Editar — ${cliente.nome}`} onFechar={() => setAberto(false)}>
        <div className="flex flex-col gap-6">
          <ClienteForm
            clienteId={cliente.id}
            dadosIniciais={{
              nome: cliente.nome,
              telefone: cliente.telefone,
              cpf: cliente.cpf,
              endereco: cliente.endereco,
              observacoes: cliente.observacoes,
              ativo: cliente.ativo,
            }}
            onSucesso={() => setAberto(false)}
          />

          <div className="border-t border-slate-100 pt-4 flex flex-col gap-2">
            <Button variante="danger" tamanho="sm" onClick={() => setPedindoConfirmacaoDesativar(true)}>
              Desativar cliente
            </Button>
            <Button variante="ghost" tamanho="sm" onClick={() => setPedindoConfirmacaoExcluir(true)}>
              Excluir cliente definitivamente
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        aberto={pedindoConfirmacaoDesativar}
        titulo="Desativar cliente"
        onFechar={() => setPedindoConfirmacaoDesativar(false)}
        rodape={
          <>
            <Button variante="secondary" tamanho="sm" onClick={() => setPedindoConfirmacaoDesativar(false)}>
              Voltar
            </Button>
            <Button variante="danger" tamanho="sm" onClick={confirmarDesativar} carregando={desativando}>
              Confirmar desativação
            </Button>
          </>
        }
      >
        <strong>{cliente.nome}</strong> deixa de aparecer nas listas ativas. O cadastro não é apagado, só fica
        marcado como inativo — pode ser reativado depois, editando e marcando "Cliente ativo" de novo.
      </Modal>

      <Modal
        aberto={pedindoConfirmacaoExcluir}
        titulo="Excluir cliente definitivamente"
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
          O cadastro de <strong>{cliente.nome}</strong> será apagado de vez — diferente de desativar, isso{" "}
          <strong>não pode ser desfeito</strong>.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Só é possível excluir clientes que nunca apareceram em nenhuma venda. Se este cliente já comprou algo
          (fiado ou não), a exclusão será recusada — use "Desativar" nesse caso, pra não perder o histórico da
          venda.
        </p>
      </Modal>
    </>
  );
}