"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Plus, Camera } from "lucide-react";
import { DadosProduto, precoVendaAbaixoDoCusto, PADRAO_ESTOQUE_MINIMO } from "@/lib/produtos/validacao";
import { criarProdutoAction, atualizarProdutoAction } from "@/lib/produtos/actions";
import { criarCategoriaAction } from "@/lib/produtos/categorias-actions";
import { criarFornecedorAction } from "@/lib/produtos/fornecedores-actions";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Alert } from "@/components/ui/Alert";
import { useToast } from "@/components/ui/ToastProvider";

const LeitorCameraModal = dynamic(
  () => import("@/components/ui/LeitorCameraModal").then((m) => m.LeitorCameraModal),
  { ssr: false }
);

interface ProdutoFormProps {
  categorias: { id: string; nome: string }[];
  fornecedores: { id: string; nome: string }[];
  produtoId?: string;
  dadosIniciais?: DadosProduto;
  onSucesso?: () => void;
}

const VAZIO: DadosProduto = {
  nome: "",
  categoria_id: "",
  fornecedor_id: "",
  preco_venda: 0,
  preco_custo: 0,
  estoque_minimo: PADRAO_ESTOQUE_MINIMO,
  codigo_barras: "",
  unidade: "un",
  descricao: "",
  ativo: true,
};

export function ProdutoForm({
  categorias: categoriasIniciais,
  fornecedores: fornecedoresIniciais,
  produtoId,
  dadosIniciais,
  onSucesso,
}: ProdutoFormProps) {
  const [categorias, setCategorias] = useState(categoriasIniciais);
  const [novaCategoria, setNovaCategoria] = useState("");
  const [criandoCategoria, setCriandoCategoria] = useState(false);
  const [fornecedores, setFornecedores] = useState(fornecedoresIniciais);
  const [novoFornecedor, setNovoFornecedor] = useState("");
  const [criandoFornecedor, setCriandoFornecedor] = useState(false);
  const [dados, setDados] = useState<DadosProduto>(dadosIniciais ?? VAZIO);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [pedindoConfirmacaoMargem, setPedindoConfirmacaoMargem] = useState(false);
  const [leitorCameraAberto, setLeitorCameraAberto] = useState(false);
  const { mostrar } = useToast();

  const emEdicao = !!produtoId;
  const alertaMargem = precoVendaAbaixoDoCusto(dados);

  async function salvarDeFato() {
    if (salvando) return;
    setSalvando(true);
    setErroGeral(null);
    setErros({});
    setPedindoConfirmacaoMargem(false);

    const resultado = emEdicao
      ? await atualizarProdutoAction(produtoId, dados)
      : await criarProdutoAction(dados);

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
    mostrar("success", emEdicao ? "Produto atualizado." : "Produto salvo.");
    onSucesso?.();
  }

  function aoClicarSalvar() {
    if (salvando) return;
    if (alertaMargem) {
      setPedindoConfirmacaoMargem(true);
      return;
    }
    salvarDeFato();
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

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Categoria</label>
        <Select
          value={dados.categoria_id}
          erro={erros.categoria_id}
          onChange={(e) => setDados({ ...dados, categoria_id: e.target.value })}
        >
          <option value="">Selecione...</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Select>

        <div className="flex gap-2 mt-1">
          <input
            placeholder="Nova categoria..."
            className="flex-1 h-9 px-3 rounded-lg text-sm border border-slate-300 focus:border-brand-600"
            value={novaCategoria}
            onChange={(e) => setNovaCategoria(e.target.value)}
          />
          <Button
            variante="secondary"
            tamanho="sm"
            disabled={criandoCategoria || novaCategoria.trim().length < 2}
            onClick={async () => {
              setCriandoCategoria(true);
              const resultado = await criarCategoriaAction(novaCategoria);
              setCriandoCategoria(false);
              if (resultado.sucesso && resultado.categoria) {
                setCategorias((c) => [...c, resultado.categoria!]);
                setDados((d) => ({ ...d, categoria_id: resultado.categoria!.id }));
                setNovaCategoria("");
              }
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Select
          rotulo="Fornecedor (opcional)"
          value={dados.fornecedor_id ?? ""}
          onChange={(e) => setDados({ ...dados, fornecedor_id: e.target.value || null })}
        >
          <option value="">Nenhum</option>
          {fornecedores.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </Select>

        <div className="flex gap-2 mt-1">
          <input
            placeholder="Novo fornecedor..."
            className="flex-1 h-9 px-3 rounded-lg text-sm border border-slate-300 focus:border-brand-600"
            value={novoFornecedor}
            onChange={(e) => setNovoFornecedor(e.target.value)}
          />
          <Button
            variante="secondary"
            tamanho="sm"
            disabled={criandoFornecedor || novoFornecedor.trim().length < 2}
            onClick={async () => {
              setCriandoFornecedor(true);
              const resultado = await criarFornecedorAction({ nome: novoFornecedor.trim() });
              setCriandoFornecedor(false);
              if (resultado.sucesso && resultado.fornecedor) {
                setFornecedores((f) => [...f, resultado.fornecedor!]);
                setDados((d) => ({ ...d, fornecedor_id: resultado.fornecedor!.id }));
                setNovoFornecedor("");
              }
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar
          </Button>
        </div>
      </div>

      <div className="flex gap-3">
        <Input
          rotulo="Preço de custo"
          type="number"
          step="0.01"
          className="flex-1"
          value={dados.preco_custo}
          erro={erros.preco_custo}
          onChange={(e) => setDados({ ...dados, preco_custo: Number(e.target.value) })}
        />
        <Input
          rotulo="Preço de venda"
          type="number"
          step="0.01"
          className="flex-1"
          value={dados.preco_venda}
          erro={erros.preco_venda}
          onChange={(e) => setDados({ ...dados, preco_venda: Number(e.target.value) })}
        />
      </div>

      {alertaMargem && <Alert variante="warning">Preço de venda está abaixo do custo.</Alert>}

      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700">Código de barras (opcional)</label>
          <div className="flex gap-2">
            <Input
              value={dados.codigo_barras ?? ""}
              erro={erros.codigo_barras}
              onChange={(e) => setDados({ ...dados, codigo_barras: e.target.value })}
              className="flex-1"
            />
            <Button
              type="button"
              variante="secondary"
              onClick={() => setLeitorCameraAberto(true)}
              aria-label="Escanear código de barras com a câmera"
            >
              <Camera className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <Select
          rotulo="Unidade"
          className="w-28"
          value={dados.unidade ?? "un"}
          onChange={(e) => setDados({ ...dados, unidade: e.target.value as "un" | "kg" | "l" })}
        >
          <option value="un">Unidade</option>
          <option value="kg">Kg</option>
          <option value="l">Litro</option>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-slate-700">Descrição (opcional)</label>
        <textarea
          className="h-20 px-3 py-2 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600"
          value={dados.descricao ?? ""}
          onChange={(e) => setDados({ ...dados, descricao: e.target.value })}
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
          Produto ativo
        </label>
      )}

      {erroGeral && <Alert variante="danger">{erroGeral}</Alert>}

      {leitorCameraAberto && (
        <LeitorCameraModal
          aberto={leitorCameraAberto}
          onFechar={() => setLeitorCameraAberto(false)}
          onCodigoLido={(codigo) => {
            setDados((d) => ({ ...d, codigo_barras: codigo }));
            setLeitorCameraAberto(false);
          }}
        />
      )}

      <Button tamanho="lg" carregando={salvando} disabled={salvando} onClick={aoClicarSalvar}>
        {emEdicao ? "Salvar alterações" : "Salvar produto"}
      </Button>

      <Modal
        aberto={pedindoConfirmacaoMargem}
        titulo="Confirmar preço abaixo do custo"
        onFechar={() => setPedindoConfirmacaoMargem(false)}
        rodape={
          <>
            <Button variante="secondary" tamanho="sm" onClick={() => setPedindoConfirmacaoMargem(false)}>
              Voltar
            </Button>
            <Button variante="primary" tamanho="sm" onClick={salvarDeFato}>
              Salvar mesmo assim
            </Button>
          </>
        }
      >
        O preço de venda está abaixo do preço de custo. Tem certeza que quer salvar assim?
      </Modal>
    </div>
  );
}