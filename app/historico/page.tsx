import { listarHistorico } from "@/services/historico.service";

export default async function HistoricoPage() {
  const eventos = await listarHistorico(7);

  return (
    <main className="max-w-3xl mx-auto p-6 flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-slate-900">Histórico de Operações</h1>
      <p className="text-slate-500 text-sm">Últimos 7 dias</p>

      <ul className="flex flex-col gap-1">
        {eventos.map((e) => (
          <li key={`${e.tipo}-${e.id}`} className="border-b py-3">
            <div className="flex justify-between items-start">
              <p className="text-lg">{e.descricao}</p>
              <p className="text-slate-400 text-xs whitespace-nowrap ml-3">
                {new Date(e.created_at).toLocaleString("pt-BR")}
              </p>
            </div>
            <p className="text-slate-500 text-sm">
              {e.funcionario_nome}
              {e.dispositivo && ` · ${e.dispositivo}`}
            </p>
          </li>
        ))}
        {eventos.length === 0 && (
          <p className="text-slate-400 py-8 text-center">Nenhuma operação no período.</p>
        )}
      </ul>
    </main>
  );
}
