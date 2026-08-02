"use client";

import { useState, useMemo } from "react";
import { Search, History as HistoryIcon, ShoppingCart, Boxes, Printer, FileDown } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ImpressaoHistorico } from "./ImpressaoHistorico";
import type { EventoHistorico } from "@/services/historico.service";

interface HistoricoListaProps {
  eventos: EventoHistorico[];
  rotuloPeriodo: string;
}

export function HistoricoLista({ eventos, rotuloPeriodo }: HistoricoListaProps) {
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return eventos;
    return eventos.filter((e) => e.texto_busca.includes(termo));
  }, [busca, eventos]);

  function imprimir() {
    window.print();
  }

  return (
    <>
      <Card semPadding className="no-print">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 pt-5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              placeholder="Procurar por produto, código de barras, funcionário ou tipo..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full h-11 pl-10 pr-3 rounded-lg text-base bg-white border border-slate-300 focus:border-brand-600"
            />
          </div>
          <div className="flex gap-2">
            <Button variante="secondary" tamanho="sm" onClick={imprimir}>
              <Printer className="w-3.5 h-3.5" />
              Imprimir
            </Button>
            <Button variante="secondary" tamanho="sm" onClick={imprimir}>
              <FileDown className="w-3.5 h-3.5" />
              Salvar em PDF
            </Button>
          </div>
        </div>

        {filtrados.length === 0 ? (
          <div className="py-6">
            <EmptyState
              icone={HistoryIcon}
              titulo={busca ? "Nenhum resultado encontrado" : "Nenhuma operação no período"}
              descricao={busca ? "Tente buscar por outro termo." : undefined}
            />
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-50 px-5 py-2 mt-2">
            {filtrados.map((e) => {
              const Icone = e.tipo === "venda" ? ShoppingCart : Boxes;
              return (
                <li key={`${e.tipo}-${e.id}`} className="flex items-start gap-3 py-3">
                  <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center shrink-0 mt-0.5">
                    <Icone className="w-4 h-4 text-brand-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-3">
                      <p className="text-slate-800">{e.descricao}</p>
                      <p className="text-slate-400 text-xs whitespace-nowrap shrink-0">
                        {new Date(e.created_at).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    <p className="text-slate-500 text-sm">
                      {e.funcionario_nome}
                      {e.dispositivo && ` · ${e.dispositivo}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ImpressaoHistorico eventos={filtrados} rotuloPeriodo={rotuloPeriodo} termoBusca={busca} />
    </>
  );
}