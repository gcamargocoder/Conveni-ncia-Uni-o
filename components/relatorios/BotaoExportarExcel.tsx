"use client";

import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { exportarRelatorioVendasAction } from "@/lib/relatorios/actions";

const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Baixa a planilha com os MESMOS filtros da tela: recebe a query string canônica do filtro já lido no servidor
 * (`paraQueryString`), então o que se exporta é exatamente o que se vê.
 */
export function BotaoExportarExcel({ consulta }: { consulta: string }) {
  const [exportando, setExportando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  async function exportar() {
    setExportando(true);
    setMensagem(null);
    try {
      const r = await exportarRelatorioVendasAction(Object.fromEntries(new URLSearchParams(consulta)));
      if (!r.sucesso) {
        setMensagem(r.erro);
        return;
      }
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: TIPO_XLSX }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.nome;
      a.click();
      URL.revokeObjectURL(url);
      if (r.truncado) setMensagem("Atenção: há mais vendas que o limite da planilha. Reduza o período.");
    } catch {
      setMensagem("Não foi possível gerar a planilha. Verifique a conexão e tente de novo.");
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={exportar}
        disabled={exportando}
        className="inline-flex items-center gap-2 h-11 px-4 rounded-xl text-sm font-medium border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {exportando ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 text-emerald-600" />}
        Exportar Excel
      </button>
      {mensagem && (
        <p role="alert" className="text-xs text-amber-700">
          {mensagem}
        </p>
      )}
    </div>
  );
}
