import { listarFuncionarios } from "@/services/funcionarios.service";
import { FuncionarioForm } from "@/components/funcionarios/FuncionarioForm";

export default async function FuncionariosPage() {
  const funcionarios = await listarFuncionarios();

  return (
    <main className="max-w-3xl mx-auto p-6 flex flex-col gap-8">
      <h1 className="text-2xl font-bold text-slate-900">Funcionários</h1>
      <FuncionarioForm />
      <ul className="flex flex-col gap-2">
        {funcionarios.map((f) => (
          <li key={f.id} className="border-b py-2 text-lg flex justify-between">
            <span>{f.nome}</span>
            <span className="text-slate-500 capitalize">{f.cargo}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
