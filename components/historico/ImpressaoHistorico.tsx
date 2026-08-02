import type { EventoHistorico } from "@/services/historico.service";

interface ImpressaoHistoricoProps {
  eventos: EventoHistorico[];
  rotuloPeriodo: string;
  termoBusca: string;
}

export function ImpressaoHistorico({ eventos, rotuloPeriodo, termoBusca }: ImpressaoHistoricoProps) {
  const geradoEm = new Date().toLocaleString("pt-BR");

  return (
    <div className="print-only">
      <header className="flex items-center gap-4 border-b-2 border-slate-900 pb-4 mb-4">
        <img src="/logo-auto-posto-uniao.jpeg" alt="Auto Posto União" className="w-14 h-14 rounded object-cover" />
        <div>
          <p className="text-lg font-bold text-slate-900">Auto Posto União</p>
          <p className="text-base font-semibold text-slate-800">Relatório de Histórico</p>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm mb-4">
        <div className="flex gap-2">
          <dt className="font-medium text-slate-600">Período:</dt>
          <dd className="text-slate-900">{rotuloPeriodo}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium text-slate-600">Gerado em:</dt>
          <dd className="text-slate-900">{geradoEm}</dd>
        </div>
        {termoBusca && (
          <div className="flex gap-2">
            <dt className="font-medium text-slate-600">Filtro de busca:</dt>
            <dd className="text-slate-900">&quot;{termoBusca}&quot;</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="font-medium text-slate-600">Total de registros:</dt>
          <dd className="text-slate-900">{eventos.length}</dd>
        </div>
      </dl>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-900 text-left">
            <th className="py-1.5 pr-2">Data</th>
            <th className="py-1.5 pr-2">Hora</th>
            <th className="py-1.5 pr-2">Produto</th>
            <th className="py-1.5 pr-2">Funcionário</th>
            <th className="py-1.5 pr-2">Tipo</th>
            <th className="py-1.5 pr-2">Qtd.</th>
            <th className="py-1.5">Observações</th>
          </tr>
        </thead>
        <tbody>
          {eventos.map((e) => {
            const data = new Date(e.created_at);
            return (
              <tr key={`${e.tipo}-${e.id}`} className="border-b border-slate-200">
                <td className="py-1.5 pr-2 whitespace-nowrap">{data.toLocaleDateString("pt-BR")}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">
                  {data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="py-1.5 pr-2">{e.produto_nome}</td>
                <td className="py-1.5 pr-2">{e.funcionario_nome}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">{e.tipo_rotulo}</td>
                <td className="py-1.5 pr-2">{e.quantidade ?? "—"}</td>
                <td className="py-1.5">{e.observacao ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}