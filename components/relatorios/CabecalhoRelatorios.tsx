import { BotaoExportarExcel } from "./BotaoExportarExcel";
import { ImpressaoRelatorios } from "./ImpressaoRelatorios";

type PropsImpressao = Parameters<typeof ImpressaoRelatorios>[0];

/**
 * Título + ações da tela de Relatórios.
 *
 * ATENÇÃO (causa da impressão em branco): o bloco `.print-only` da impressão mora DENTRO deste cabeçalho. Nenhum
 * ancestral dele pode ser `.no-print` (que é `display:none !important` e esconde também os descendentes). Por isso
 * só o título e os botões levam `no-print`, nunca o cabeçalho nem o contêiner das ações.
 */
export function CabecalhoRelatorios({ consulta, impressao }: { consulta: string; impressao: PropsImpressao }) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:block">
      <div className="no-print">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Relatórios</h1>
        <p className="text-slate-500 text-sm">Vendas e estoque por período — horário da loja (Brasília)</p>
      </div>
      <div className="flex items-center gap-2 print:block">
        <div className="no-print">
          <BotaoExportarExcel consulta={consulta} />
        </div>
        <ImpressaoRelatorios {...impressao} />
      </div>
    </header>
  );
}
