import { listarFornecedores } from "@/services/fornecedores.service";
import { FornecedorForm } from "@/components/fornecedores/FornecedorForm";

export default async function FornecedoresPage() {
  const fornecedores = await listarFornecedores();

  return (
    <main className="max-w-3xl mx-auto p-6 flex flex-col gap-8">
      <h1 className="text-2xl font-bold text-slate-900">Fornecedores</h1>
      <FornecedorForm />
      <ul className="flex flex-col gap-2">
        {fornecedores.map((f) => (
          <li key={f.id} className="border-b py-2 text-lg">
            {f.nome} {f.telefone && <span className="text-slate-500">— {f.telefone}</span>}
          </li>
        ))}
      </ul>
    </main>
  );
}
