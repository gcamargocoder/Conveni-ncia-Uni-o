"use client";

import { useMemo, useState } from "react";
import { Tags } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { CampoBusca } from "@/components/ui/CampoBusca";
import { Table } from "@/components/ui/Table";
import { ProdutoEditarModal } from "./ProdutoEditarModal";
import { normalizarBusca } from "@/lib/utils/busca";
import type { Produto } from "@/types/produto";

/** Linhas desenhadas por vez: a pesquisa varre TODOS os produtos carregados, mas o DOM só recebe uma fatia (3.000 linhas duplicadas, tabela + cartões, pesavam ~9 MB). */
export const LINHAS_POR_VEZ = 100;

type Opcao = { id: string; nome: string };

interface ListaProdutosProps {
  produtos: Produto[];
  categorias: Opcao[];
  fornecedores: Opcao[];
  /** Total cadastrado. Maior que `produtos.length` quando a tela atingiu o limite de carregamento. */
  total: number;
}

export function ListaProdutos({ produtos, categorias, fornecedores, total }: ListaProdutosProps) {
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState(LINHAS_POR_VEZ);
  const buscando = busca.trim() !== "";
  const naoCarregados = Math.max(total - produtos.length, 0);
  // Nomes normalizados uma vez por lista (não a cada tecla): com 3.000 produtos a digitação continua instantânea.
  const indice = useMemo(() => produtos.map((p) => normalizarBusca(p.nome)), [produtos]);
  const termo = normalizarBusca(busca);
  const filtrado = useMemo(
    () => (termo ? produtos.filter((_, i) => indice[i].includes(termo)) : produtos),
    [produtos, indice, termo]
  );

  const exibidos = filtrado.slice(0, linhas);
  const restantes = filtrado.length - exibidos.length;

  return (
    <>
      <div className="flex items-center gap-2 px-5 pt-5 mb-1">
        <Tags className="w-4 h-4 text-orange-500" />
        <h2 className="text-sm font-semibold text-slate-700">
          {buscando
            ? `Encontrados (${filtrado.length} de ${produtos.length} carregados)`
            : naoCarregados > 0
              ? `Cadastrados (${total}) — ${produtos.length} carregados`
              : `Cadastrados (${total})`}
        </h2>
      </div>
      <div className="flex px-5 pb-3">
        <CampoBusca valor={busca} onChange={(v) => {
            setBusca(v);
            setLinhas(LINHAS_POR_VEZ);
          }} placeholder="Pesquisar produto pelo nome..." corIcone="text-orange-500" />
      </div>
      {naoCarregados > 0 && (
        <p role="status" className="px-5 pb-2 text-xs text-amber-700">
          Limite de carregamento: há {total} produtos cadastrados, mas só os primeiros {produtos.length} (ordem alfabética) foram
          carregados. A pesquisa não alcança os outros {naoCarregados}. Avise o suporte para ampliar o limite.
        </p>
      )}
      <Table
        colunas={[
          { chave: "nome", cabecalho: "Nome" },
          { chave: "preco_venda", cabecalho: "Preço", render: (p) => `R$ ${p.preco_venda.toFixed(2)}` },
          { chave: "estoque_minimo", cabecalho: "Estoque mín." },
          {
            chave: "situacao",
            cabecalho: "Situação",
            render: (p) =>
              p.ativo ? <span className="text-slate-400 text-xs">Ativo</span> : <Badge variante="neutral">Inativo</Badge>,
          },
          {
            chave: "acoes",
            cabecalho: "",
            render: (p) => <ProdutoEditarModal produto={p} categorias={categorias} fornecedores={fornecedores} />,
          },
        ]}
        dados={exibidos}
        chaveLinha={(p) => p.id}
        vazioIcone={Tags}
        vazioModulo="produtos"
        vazioTitulo={buscando ? "Nenhum produto encontrado" : "Nenhum produto cadastrado ainda"}
        vazioDescricao={
          buscando
            ? naoCarregados > 0
              ? `Nenhum dos ${produtos.length} produtos carregados corresponde, mas ${naoCarregados} não foram carregados (limite) e podem conter o produto.`
              : "Nenhum nome corresponde à pesquisa. Confira a grafia ou apague o texto."
            : 'Clique em "Cadastrar produto" para começar.'
        }
      />
      {filtrado.length > LINHAS_POR_VEZ && (
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 text-xs text-slate-600">
          <span role="status">
            Exibindo {exibidos.length} de {filtrado.length}
            {buscando ? " encontrados" : " produtos"}
          </span>
          {restantes > 0 && (
            <Button variante="secondary" tamanho="sm" onClick={() => setLinhas((n) => n + LINHAS_POR_VEZ)}>
              Mostrar mais {Math.min(restantes, LINHAS_POR_VEZ)}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
