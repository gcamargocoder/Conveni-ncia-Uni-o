"use client";

import { useState } from "react";
import { criarFornecedorAction, atualizarFornecedorAction } from "@/lib/produtos/fornecedores-actions";
import { DadosFornecedor } from "@/lib/fornecedores/validacao";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { useToast } from "@/components/ui/ToastProvider";

const ESTADOS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export interface FornecedorFormProps {
  fornecedorId?: string;
  dadosIniciais?: DadosFornecedor;
  onSucesso?: () => void;
}

const VAZIO: DadosFornecedor = {
  nome: "",
  razao_social: "",
  cnpj_cpf: "",
  telefone: "",
  whatsapp: "",
  email: "",
  endereco: "",
  cidade: "",
  estado: "",
  observacoes: "",
  ativo: true,
};

export function FornecedorForm({ fornecedorId, dadosIniciais, onSucesso }: FornecedorFormProps) {
  const [dados, setDados] = useState<DadosFornecedor>(dadosIniciais ?? VAZIO);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const { mostrar } = useToast();

  const emEdicao = !!fornecedorId;

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    setErroGeral(null);
    setErros({});

    const resultado = emEdicao
      ? await atualizarFornecedorAction(fornecedorId, dados)
      : await criarFornecedorAction(dados);

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
    mostrar("success", emEdicao ? "Fornecedor atualizado." : "Fornecedor adicionado.");
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
        rotulo="Razão social (opcional)"
        value={dados.razao_social ?? ""}
        onChange={(e) => setDados({ ...dados, razao_social: e.target.value })}
      />
      <Input
        rotulo="CNPJ ou CPF (opcional)"
        value={dados.cnpj_cpf ?? ""}
        erro={erros.cnpj_cpf}
        onChange={(e) => setDados({ ...dados, cnpj_cpf: e.target.value })}
      />

      <div className="flex gap-3">
        <Input
          rotulo="Telefone (opcional)"
          className="flex-1"
          value={dados.telefone ?? ""}
          erro={erros.telefone}
          onChange={(e) => setDados({ ...dados, telefone: e.target.value })}
        />
        <Input
          rotulo="WhatsApp (opcional)"
          className="flex-1"
          value={dados.whatsapp ?? ""}
          erro={erros.whatsapp}
          onChange={(e) => setDados({ ...dados, whatsapp: e.target.value })}
        />
      </div>

      <Input
        rotulo="E-mail (opcional)"
        type="email"
        value={dados.email ?? ""}
        erro={erros.email}
        onChange={(e) => setDados({ ...dados, email: e.target.value })}
      />
      <Input
        rotulo="Endereço (opcional)"
        value={dados.endereco ?? ""}
        onChange={(e) => setDados({ ...dados, endereco: e.target.value })}
      />

      <div className="flex gap-3">
        <Input
          rotulo="Cidade (opcional)"
          className="flex-1"
          value={dados.cidade ?? ""}
          onChange={(e) => setDados({ ...dados, cidade: e.target.value })}
        />
        <Select
          rotulo="Estado"
          className="w-28"
          value={dados.estado ?? ""}
          onChange={(e) => setDados({ ...dados, estado: e.target.value })}
        >
          <option value="">--</option>
          {ESTADOS.map((uf) => (
            <option key={uf} value={uf}>
              {uf}
            </option>
          ))}
        </Select>
      </div>

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
          Fornecedor ativo
        </label>
      )}

      {erroGeral && <Alert variante="danger">{erroGeral}</Alert>}

      <Button onClick={salvar} carregando={salvando} disabled={salvando || dados.nome.trim().length < 2}>
        {emEdicao ? "Salvar alterações" : "Adicionar fornecedor"}
      </Button>
    </div>
  );
}