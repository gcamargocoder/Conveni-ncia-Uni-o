import { Users } from "lucide-react";
import { listarFuncionarios } from "@/services/funcionarios.service";
import { FuncionarioCadastroModal } from "@/components/funcionarios/FuncionarioCadastroModal";
import { FuncionarioEditarModal } from "@/components/funcionarios/FuncionarioEditarModal";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";

export default async function FuncionariosPage() {
  const funcionarios = await listarFuncionarios();

  return (
    <main className="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Funcionários</h1>
          <p className="text-slate-500 text-sm">Cadastro e cargos</p>
        </div>
        <FuncionarioCadastroModal />
      </header>

      <Card semPadding>
        <div className="flex items-center gap-2 px-5 pt-5 mb-1">
          <Users className="w-4 h-4 text-brand-700" />
          <h2 className="text-sm font-semibold text-slate-700">Cadastrados ({funcionarios.length})</h2>
        </div>
        <Table
          colunas={[
            { chave: "nome", cabecalho: "Nome" },
            {
              chave: "cargo",
              cabecalho: "Cargo",
              render: (f) => <Badge variante="brand">{f.cargo}</Badge>,
            },
            {
              chave: "acoes",
              cabecalho: "",
              render: (f) => <FuncionarioEditarModal funcionario={f} />,
            },
          ]}
          dados={funcionarios}
          chaveLinha={(f) => f.id}
          vazioIcone={Users}
          vazioTitulo="Nenhum funcionário cadastrado ainda"
          vazioDescricao='Clique em "Cadastrar funcionário" para começar.'
        />
      </Card>
    </main>
  );
}