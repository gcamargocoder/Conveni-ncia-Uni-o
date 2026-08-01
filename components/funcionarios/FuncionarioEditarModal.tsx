"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Funcionario, Cargo } from "@/types/funcionario";
import { atualizarFuncionarioAction, excluirFuncionarioAction } from "@/lib/auth/funcionarios-actions";
import { PinInput } from "@/components/auth/PinInput";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/ToastProvider";

const CARGOS: { valor: Cargo; rotulo: string }[] = [
  { valor: "caixa", rotulo: "Caixa" },
  { valor: "frentista", rotulo: "Frentista" },
  { valor: "estoquista", rotulo: "Estoquista" },
  { valor: "gerente", rotulo: "Gerente" },
  { valor: "proprietario", rotulo: "Proprietário" },
];

type AcaoPendente = "nome" | "cargo" | "pin" | "excluir" | null;

interface FuncionarioEditarModalProps {
  funcionario: Funcionario;
}

export function FuncionarioEditarModal({ funcionario }: FuncionarioEditarModalProps) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(funcionario.nome);
  const [cargo, setCargo] = useState<Cargo>(funcionario.cargo);
  const [novoPin, setNovoPin] = useState("");
  const [acaoPendente, setAcaoPendente] = useState<AcaoPendente>(null);
  const [pedindoConfirmacaoExclusao, setPedindoConfirmacaoExclusao] = useState(false);
  const { mostrar } = useToast();

  async function confirmarComPin(pin: string) {
    if (acaoPendente === "nome") {
      const resultado = await atualizarFuncionarioAction(funcionario.id, { nome }, pin);
      if (!resultado.sucesso) throw new Error(resultado.erro ?? "Erro ao renomear.");
      mostrar("success", "Nome atualizado.");
    } else if (acaoPendente === "cargo") {
      const resultado = await atualizarFuncionarioAction(funcionario.id, { cargo }, pin);
      if (!resultado.sucesso) throw new Error(resultado.erro ?? "Erro ao trocar cargo.");
      mostrar("success", "Cargo atualizado.");
    } else if (acaoPendente === "pin") {
      const resultado = await atualizarFuncionarioAction(funcionario.id, { pin: novoPin }, pin);
      if (!resultado.sucesso) throw new Error(resultado.erro ?? "Erro ao trocar PIN.");
      setNovoPin("");
      mostrar("success", "PIN atualizado.");
    } else if (acaoPendente === "excluir") {
      const resultado = await excluirFuncionarioAction(funcionario.id, pin);
      if (!resultado.sucesso) throw new Error(resultado.erro ?? "Erro ao excluir.");
      mostrar("success", "Funcionário excluído.");
      setAberto(false);
    }
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

      <Modal aberto={aberto} titulo={`Editar — ${funcionario.nome}`} onFechar={() => setAberto(false)}>
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Nome</h3>
            <div className="flex gap-2 items-end">
              <Input value={nome} onChange={(e) => setNome(e.target.value)} className="flex-1" />
              <Button
                variante="secondary"
                onClick={() => setAcaoPendente("nome")}
                disabled={nome.trim().length < 2 || nome.trim() === funcionario.nome}
              >
                Salvar
              </Button>
            </div>
          </section>

          <div className="border-t border-slate-100" />

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Cargo</h3>
            <div className="flex gap-2 items-end">
              <Select value={cargo} onChange={(e) => setCargo(e.target.value as Cargo)} className="flex-1">
                {CARGOS.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.rotulo}
                  </option>
                ))}
              </Select>
              <Button variante="secondary" onClick={() => setAcaoPendente("cargo")} disabled={cargo === funcionario.cargo}>
                Salvar
              </Button>
            </div>
          </section>

          <div className="border-t border-slate-100" />

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Trocar PIN</h3>
            <div className="flex gap-2 items-end">
              <Input
                maxLength={4}
                placeholder="Novo PIN de 4 dígitos"
                value={novoPin}
                onChange={(e) => setNovoPin(e.target.value.replace(/\D/g, ""))}
                className="flex-1"
              />
              <Button variante="secondary" onClick={() => setAcaoPendente("pin")} disabled={novoPin.length !== 4}>
                Salvar
              </Button>
            </div>
          </section>

          <div className="border-t border-slate-100" />

          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Zona de risco</h3>
            <Button variante="danger" onClick={() => setPedindoConfirmacaoExclusao(true)}>
              Excluir funcionário
            </Button>
          </section>
        </div>
      </Modal>

      <Modal aberto={acaoPendente !== null} titulo="Autorização necessária" onFechar={() => setAcaoPendente(null)}>
        <p className="mb-4">Digite o PIN de quem está autorizando esta alteração:</p>
        <PinInput modo="confirmacao" onPinCompleto={confirmarComPin} onSucesso={() => setAcaoPendente(null)} />
      </Modal>

      <Modal
        aberto={pedindoConfirmacaoExclusao}
        titulo="Excluir funcionário"
        onFechar={() => setPedindoConfirmacaoExclusao(false)}
        rodape={
          <>
            <Button variante="secondary" tamanho="sm" onClick={() => setPedindoConfirmacaoExclusao(false)}>
              Voltar
            </Button>
            <Button
              variante="danger"
              tamanho="sm"
              onClick={() => {
                setPedindoConfirmacaoExclusao(false);
                setAcaoPendente("excluir");
              }}
            >
              Confirmar exclusão
            </Button>
          </>
        }
      >
        Isso remove <strong>{funcionario.nome}</strong> do sistema. Essa ação não pode ser desfeita.
      </Modal>
    </>
  );
}