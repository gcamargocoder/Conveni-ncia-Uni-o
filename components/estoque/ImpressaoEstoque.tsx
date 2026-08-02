import type { EstoqueAtual } from "@/services/estoque.service";

interface ImpressaoEstoqueProps {
  itens: EstoqueAtual[];
}

function codigoInterno(produtoId: string): string {
  return produtoId.slice(0, 8).toUpperCase();
}

function situacao(item: EstoqueAtual): { rotulo: string; destaque: boolean } {
  if (item.quantidade_atual <= 0) return { rotulo: "Estoque Zerado", destaque: true };
  if (item.quantidade_atual < item.estoque_minimo) return { rotulo: "Estoque Baixo", destaque: true };
  return { rotulo: "Estoque Normal", destaque: false };
}

export function ImpressaoEstoque({ itens }: ImpressaoEstoqueProps) {
  const geradoEm = new Date().toLocaleString("pt-BR");
  const totalItensEmEstoque = itens.reduce((soma, i) => soma + Math.max(i.quantidade_atual, 0), 0);

  return (
    <div className="print-only">
      <header className="flex items-center gap-4 border-b-2 border-slate-900 pb-4 mb-4">
        <img src="/logo-auto-posto-uniao.jpeg" alt="Auto Posto União" className="w-14 h-14 rounded object-cover" />
        <div>
          <p className="text-lg font-bold text-slate-900">Auto Posto União</p>
          <p className="text-base font-semibold text-slate-800">Relatório de Estoque</p>
        </div>
      </header>

      <dl className="grid grid-cols-3 gap-x-6 gap-y-1 text-sm mb-4">
        <div className="flex gap-2">
          <dt className="font-medium text-slate-600">Gerado em:</dt>
          <dd className="text-slate-900">{geradoEm}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium text-slate-600">Produtos listados:</dt>
          <dd className="text-slate-900">{itens.length}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium text-slate-600">Itens em estoque:</dt>
          <dd className="text-slate-900">{totalItensEmEstoque}</dd>
        </div>
      </dl>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b-2 border-slate-900 text-left">
            <th className="py-1.5 pr-2">Código</th>
            <th className="py-1.5 pr-2">Cód. barras</th>
            <th className="py-1.5 pr-2">Produto</th>
            <th className="py-1.5 pr-2">Categoria</th>
            <th className="py-1.5 pr-2">Fornecedor</th>
            <th className="py-1.5 pr-2">Qtd.</th>
            <th className="py-1.5 pr-2">Mín.</th>
            <th className="py-1.5">Situação</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item) => {
            const { rotulo, destaque } = situacao(item);
            return (
              <tr key={item.produto_id} className={`border-b border-slate-200 ${destaque ? "bg-slate-100" : ""}`}>
                <td className="py-1.5 pr-2 whitespace-nowrap font-mono">{codigoInterno(item.produto_id)}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">{item.codigo_barras ?? "—"}</td>
                <td className="py-1.5 pr-2">{item.nome}</td>
                <td className="py-1.5 pr-2">{item.categoria_nome ?? "—"}</td>
                <td className="py-1.5 pr-2">{item.fornecedor_nome ?? "—"}</td>
                <td className="py-1.5 pr-2 font-semibold">{item.quantidade_atual}</td>
                <td className="py-1.5 pr-2">{item.estoque_minimo}</td>
                <td className={`py-1.5 font-medium ${destaque ? "text-slate-900" : "text-slate-500"}`}>{rotulo}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}