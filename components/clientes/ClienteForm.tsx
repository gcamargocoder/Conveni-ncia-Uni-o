"use client";

import { useState } from "react";
import { criarClienteAction, atualizarClienteAction } from "@/lib/clientes/actions";
import { DadosCliente } from "@/lib/clientes/validacao";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { useToast } from "@/components/ui/ToastProvider";
import { sincronizarCatalogo } from "@/services/offline/sincronizacao-catalogo.service";

export interface ClienteFormProps {
  clienteId?: string;
  dadosIniciais?: DadosCliente;
  onSucesso?: () => void;
}

const VAZIO: DadosCliente = {
  nome: "",
  telefone: "",
  cpf: "",
  endereco: "",
  observacoes: "",
  ativo: true,
};

export function ClienteForm({ clienteId, dadosIniciais, onSucesso }: ClienteFormProps) {
  const [dados, setDados] = useState<DadosCliente>(dadosIniciais ?? VAZIO);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const { mostrar } = useToast();

  const emEdicao = !!clienteId;

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    setErroGeral(null);
    setErros({});

    const resultado = emEdicao ? await atualizarClienteAction(clienteId, dados) : await criarClienteAction(dados);

    setSalvando(false);

    if (!resultado.sucesso) {
      if (resultado.erros) {
        setErros(Object.fromEntries(resultado.erros.map((e) => [e.campo, e.mensagem])));
      }
      if (resultado.erroGeral) setErroGeral(resultado.erroGeral);
      mostrar("danger", "Não foi possível salvar. Confira os campos destacados.");
      return;
    }

    if (!emEdicao) setDados(VAZIO);
    mostrar("success", emEdicao ? "Cliente atualizado." : "Cliente cadastrado.");
    sincronizarCatalogo();
    onSucesso?.();
  }

  return (
    <div className="flex flex-col gap-4 max-w-md">
      <Input
        rotulo="Nome"
        autoFocus
        value={dados.nome}
        erro={erros.nome}
        onChange={(e) => setDados({ ...dados, nome: e.target.value })}
      />
      <Input
        rotulo="Telefone (opcional)"
        value={dados.telefone ?? ""}
        erro={erros.telefone}
        onChange={(e) => setDados({ ...dados, telefone: e.target.value })}
      />
      <Input
        rotulo="CPF (opcional)"
        value={dados.cpf ?? ""}
        erro={erros.cpf}
        onChange={(e) => setDados({ ...dados, cpf: e.target.value })}
      />
      <Input
        rotulo="Endereço (opcional)"
        value={dados.endereco ?? ""}
        onChange={(e) => setDados({ ...dados, endereco: e.target.value })}
      />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Observações (opcional)</label>
        <textarea
          className="h-20 px-3 py-2 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600"
          value={dados.observacoes ?? ""}
          onChange={(e) => setDados({ ...dados, observacoes: e.target.value })}
        />
      </div>

      {emEdicao && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={dados.ativo ?? true}
            onChange={(e) => setDados({ ...dados, ativo: e.target.checked })}
            className="w-4 h-4 rounded border-slate-300"
          />
          Cliente ativo
        </label>
      )}

      {erroGeral && <Alert variante="danger">{erroGeral}</Alert>}

      <Button onClick={salvar} carregando={salvando} disabled={salvando || dados.nome.trim().length < 2}>
        {emEdicao ? "Salvar alterações" : "Cadastrar cliente"}
      </Button>
    </div>
  );
}