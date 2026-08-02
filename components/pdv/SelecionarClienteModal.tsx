"use client";

import { useState, useEffect } from "react";
import { Search, UserPlus, ArrowLeft } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { buscarClientesLocalPorTermo } from "@/services/offline/clientes-local.service";
import { criarClienteAction } from "@/lib/clientes/actions";
import type { ClienteLocal } from "@/services/offline/db";

interface SelecionarClienteModalProps {
  aberto: boolean;
  onFechar: () => void;
  onSelecionar: (cliente: ClienteLocal) => void;
}

export function SelecionarClienteModal({ aberto, onFechar, onSelecionar }: SelecionarClienteModalProps) {
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<ClienteLocal[]>([]);
  const [cadastrando, setCadastrando] = useState(false);
  const [nomeNovo, setNomeNovo] = useState("");
  const [telefoneNovo, setTelefoneNovo] = useState("");
  const [erroCadastro, setErroCadastro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) {
      setBusca("");
      setResultados([]);
      setCadastrando(false);
      setNomeNovo("");
      setTelefoneNovo("");
      setErroCadastro(null);
    }
  }, [aberto]);

  useEffect(() => {
    const termo = busca.trim();
    if (!termo) {
      setResultados([]);
      return;
    }
    const temporizador = setTimeout(async () => {
      const encontrados = await buscarClientesLocalPorTermo(termo);
      setResultados(encontrados);
    }, 150);
    return () => clearTimeout(temporizador);
  }, [busca]);

  function abrirCadastroRapido() {
    setNomeNovo(busca);
    setErroCadastro(null);
    setCadastrando(true);
  }

  async function salvarCadastroRapido() {
    if (salvando) return;
    if (nomeNovo.trim().length < 2) {
      setErroCadastro("Nome deve ter pelo menos 2 caracteres.");
      return;
    }

    setSalvando(true);
    setErroCadastro(null);

    const resultado = await criarClienteAction({
      nome: nomeNovo.trim(),
      telefone: telefoneNovo.trim() || null,
      cpf: null,
      endereco: null,
      observacoes: null,
      ativo: true,
    });

    setSalvando(false);

    if (!resultado.sucesso || !resultado.cliente) {
      setErroCadastro(resultado.erros?.[0]?.mensagem ?? resultado.erroGeral ?? "Erro ao cadastrar cliente.");
      return;
    }

    onSelecionar({
      id: resultado.cliente.id,
      nome: resultado.cliente.nome,
      telefone: resultado.cliente.telefone,
      ativo: true,
      updated_at: resultado.cliente.updated_at,
    });
  }

  return (
    <Modal aberto={aberto} titulo={cadastrando ? "Cadastro rápido" : "Selecionar cliente"} onFechar={onFechar}>
      {!cadastrando ? (
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              autoFocus
              placeholder="Buscar cliente pelo nome..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full h-11 pl-10 pr-3 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600"
            />
          </div>

          {busca.trim() && resultados.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-2">Nenhum cliente encontrado.</p>
          )}

          <ul className="flex flex-col divide-y divide-slate-50 max-h-64 overflow-auto">
            {resultados.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onSelecionar(c)}
                  className="w-full text-left px-2 py-3 hover:bg-slate-50 transition-colors"
                >
                  <p className="text-slate-800 font-medium">{c.nome}</p>
                  {c.telefone && <p className="text-slate-500 text-xs">{c.telefone}</p>}
                </button>
              </li>
            ))}
          </ul>

          <Button variante="secondary" tamanho="sm" onClick={abrirCadastroRapido}>
            <UserPlus className="w-3.5 h-3.5" />
            Cadastrar novo cliente
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <button
            onClick={() => setCadastrando(false)}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 self-start"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Voltar pra busca
          </button>

          <Input rotulo="Nome" autoFocus value={nomeNovo} onChange={(e) => setNomeNovo(e.target.value)} />
          <Input rotulo="Telefone (opcional)" value={telefoneNovo} onChange={(e) => setTelefoneNovo(e.target.value)} />

          {erroCadastro && <Alert variante="danger">{erroCadastro}</Alert>}

          <Button onClick={salvarCadastroRapido} carregando={salvando} disabled={salvando}>
            Cadastrar e selecionar
          </Button>
        </div>
      )}
    </Modal>
  );
}