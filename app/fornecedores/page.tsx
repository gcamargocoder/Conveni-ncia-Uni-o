import { Truck } from "lucide-react";
import { listarFornecedores } from "@/services/fornecedores.service";
import { FornecedorCadastroModal } from "@/components/fornecedores/FornecedorCadastroModal";
import { Card } from "@/components/ui/Card";
import { Table } from "@/components/ui/Table";

export default async function FornecedoresPage() {
  const fornecedores = await listarFornecedores();

  return (
    <main className="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">        <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Fornecedores</h1>
        <p className="text-slate-500 text-sm">Cadastro de fornecedores</p>
      </div>
        <FornecedorCadastroModal />
      </header>

      <Card semPadding>
        <div className="flex items-center gap-2 px-5 pt-5 mb-1">
          <Truck className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Cadastrados ({fornecedores.length})</h2>
        </div>
        <Table
          colunas={[
            { chave: "nome", cabecalho: "Nome" },
            { chave: "telefone", cabecalho: "Telefone", render: (f) => f.telefone ?? "—" },
          ]}
          dados={fornecedores}
          chaveLinha={(f) => f.id}
          vazioIcone={Truck}
          vazioTitulo="Nenhum fornecedor cadastrado ainda"
          vazioDescricao='Clique em "Cadastrar fornecedor" para começar.'
        />
      </Card>
    </main>
  );
}