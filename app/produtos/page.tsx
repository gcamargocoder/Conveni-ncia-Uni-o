import { Tags } from "lucide-react";
import { listarProdutos } from "@/services/produtos.service";
import { listarFornecedores } from "@/services/fornecedores.service";
import { createSupabaseServerClient } from "@/services/supabase/server";
import { ProdutoCadastroModal } from "@/components/produtos/ProdutoCadastroModal";
import { ProdutoEditarModal } from "@/components/produtos/ProdutoEditarModal";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";

export const dynamic = "force-dynamic";

export default async function ProdutosPage() {
  const supabase = await createSupabaseServerClient();
  const [produtos, fornecedores, { data: categorias }] = await Promise.all([
    listarProdutos(),
    listarFornecedores(),
    supabase.from("categorias").select("id, nome").is("deleted_at", null).order("nome"),
  ]);

  const categoriasOpcoes = categorias ?? [];
  const fornecedoresOpcoes = fornecedores.map((f) => ({ id: f.id, nome: f.nome }));

  return (
    <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Produtos</h1>
          <p className="text-slate-500 text-sm">Produtos e categorias</p>
        </div>
        <ProdutoCadastroModal categorias={categoriasOpcoes} fornecedores={fornecedoresOpcoes} />
      </header>

      <Card semPadding>
        <div className="flex items-center gap-2 px-5 pt-5 mb-1">
          <Tags className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Cadastrados ({produtos.length})</h2>
        </div>
        <Table
          colunas={[
            { chave: "nome", cabecalho: "Nome" },
            { chave: "preco_venda", cabecalho: "Preço", render: (p) => `R$ ${p.preco_venda.toFixed(2)}` },
            { chave: "estoque_minimo", cabecalho: "Estoque mín." },
            {
              chave: "situacao",
              cabecalho: "Situação",
              render: (p) =>
                p.ativo ? (
                  <span className="text-slate-400 text-xs">Ativo</span>
                ) : (
                  <Badge variante="neutral">Inativo</Badge>
                ),
            },
            {
              chave: "acoes",
              cabecalho: "",
              render: (p) => (
                <ProdutoEditarModal produto={p} categorias={categoriasOpcoes} fornecedores={fornecedoresOpcoes} />
              ),
            },
          ]}
          dados={produtos}
          chaveLinha={(p) => p.id}
          vazioIcone={Tags}
          vazioTitulo="Nenhum produto cadastrado ainda"
          vazioDescricao='Clique em "Cadastrar produto" para começar.'
        />
      </Card>
    </main>
  );
}