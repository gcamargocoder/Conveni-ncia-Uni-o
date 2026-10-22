import { Users } from "lucide-react";
import { listarClientes } from "@/services/clientes.service";
import { ClienteCadastroModal } from "@/components/clientes/ClienteCadastroModal";
import { ListaClientes } from "@/components/clientes/ListaClientes";
import { AutorizacaoPinProvider } from "@/components/auth/useAutorizacaoPin";
import { Card } from "@/components/ui/Card";
import { exigirSessao } from "@/lib/auth/servidor";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  await exigirSessao();
  const clientes = await listarClientes();

  return (
    <AutorizacaoPinProvider>
    <main className="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Clientes</h1>
          <p className="text-slate-500 text-sm">Cadastro de clientes</p>
        </div>
        <ClienteCadastroModal />
      </header>

      <Card semPadding>
        <div className="flex items-center gap-2 px-5 pt-5 mb-1">
          <Users className="w-4 h-4 text-fuchsia-500" />
          <h2 className="text-sm font-semibold text-slate-700">Cadastrados ({clientes.length})</h2>
        </div>
        <ListaClientes clientes={clientes} />
      </Card>
    </main>
    </AutorizacaoPinProvider>
  );
}