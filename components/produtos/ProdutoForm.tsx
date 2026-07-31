"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { DadosProduto, precoVendaAbaixoDoCusto, PADRAO_ESTOQUE_MINIMO } from "@/lib/produtos/validacao";
import { criarProdutoAction } from "@/lib/produtos/actions";
import { criarCategoriaAction } from "@/lib/produtos/categorias-actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Alert } from "@/components/ui/Alert";
import { useToast } from "@/components/ui/ToastProvider";

interface ProdutoFormProps {
  categorias: { id: string; nome: string }[];
  onSucesso?: () => void;
}

const VAZIO: DadosProduto = {
  nome: "",
  categoria_id: "",
  preco_venda: 0,
  preco_custo: 0,
  estoque_minimo: PADRAO_ESTOQUE_MINIMO,
  codigo_barras: "",
};

const CLASSES_SELECT = "h-11 px-3 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600";

export function ProdutoForm({ categorias: categoriasIniciais, onSucesso }: ProdutoFormProps) {
  const [categorias, setCategorias] = useState(categoriasIniciais);
  const [novaCategoria, setNovaCategoria] = useState("");
  const [criandoCategoria, setCriandoCategoria] = useState(false);
  const [dados, setDados] = useState<DadosProduto>(VAZIO);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [pedindoConfirmacaoMargem, setPedindoConfirmacaoMargem] = useState(false);
  const { mostrar } = useToast();

  const alertaMargem = precoVendaAbaixoDoCusto(dados);

  async function salvarDeFato() {
    setSalvando(true);
    setErroGeral(null);
    setErros({});
    setPedindoConfirmacaoMargem(false);

    const resultado = await criarProdutoAction(dados);
    setSalvando(false);

    if (!resultado.sucesso) {
      if (resultado.erros) {
        setErros(Object.fromEntries(resultado.erros.map((e) => [e.campo, e.mensagem])));
      }
      if (resultado.erroGeral) setErroGeral(resultado.erroGeral);
      return;
    }

    setDados(VAZIO);
    mostrar("success", "Produto salvo.");
    onSucesso?.();
  }

  function aoClicarSalvar() {
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
        <select
          className={CLASSES_SELECT}
          value={dados.categoria_id}
          onChange={(e) => setDados({ ...dados, categoria_id: e.target.value })}
        >
          <option value="">Selecione...</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
        {erros.categoria_id && <p className="text-danger-600 text-sm">{erros.categoria_id}</p>}

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

      <Input
        rotulo="Código de barras (opcional)"
        value={dados.codigo_barras ?? ""}
        erro={erros.codigo_barras}
        onChange={(e) => setDados({ ...dados, codigo_barras: e.target.value })}
      />

      {erroGeral && <Alert variante="danger">{erroGeral}</Alert>}

      <Button tamanho="lg" carregando={salvando} onClick={aoClicarSalvar}>
        Salvar produto
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