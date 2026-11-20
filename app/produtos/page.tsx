import { listarProdutosParaTela } from "@/services/produtos.service";
import { listarFornecedores } from "@/services/fornecedores.service";
import { listarCategorias } from "@/services/categorias.service";
import { ProdutoCadastroModal } from "@/components/produtos/ProdutoCadastroModal";
import { ListaProdutos } from "@/components/produtos/ListaProdutos";
import { AutorizacaoPinProvider } from "@/components/auth/useAutorizacaoPin";
import { Card } from "@/components/ui/Card";
import { exigirSessao } from "@/lib/auth/servidor";

export const dynamic = "force-dynamic";

export default async function ProdutosPage() {
  await exigirSessao();
  const [{ produtos, total }, fornecedores, categorias] = await Promise.all([
    listarProdutosParaTela(),
    listarFornecedores(),
    listarCategorias(),
  ]);

  const categoriasOpcoes = categorias.map((c) => ({ id: c.id, nome: c.nome }));
  const fornecedoresOpcoes = fornecedores.map((f) => ({ id: f.id, nome: f.nome }));

  return (
    <AutorizacaoPinProvider>
    <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Produtos</h1>
          <p className="text-slate-500 text-sm">Produtos e categorias</p>
        </div>
        <ProdutoCadastroModal categorias={categoriasOpcoes} fornecedores={fornecedoresOpcoes} />
      </header>

      <Card semPadding>
        <ListaProdutos
          produtos={produtos}
          total={total}
          categorias={categoriasOpcoes}
          fornecedores={fornecedoresOpcoes}
        />
      </Card>
    </main>
    </AutorizacaoPinProvider>
  );
}