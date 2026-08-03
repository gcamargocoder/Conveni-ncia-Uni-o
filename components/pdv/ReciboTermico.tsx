"use client";

import { useState } from "react";
import { Eye, X } from "lucide-react";
import { VendaCompleta } from "@/services/vendas.service";

const ROTULOS_PAGAMENTO: Record<string, string> = {
  dinheiro: "Dinheiro",
  debito: "Cartão de Débito",
  credito: "Cartão de Crédito",
  pix: "PIX",
  fiado: "Fiado",
};

const ENDERECO_CONVENIENCIA = "";
const TELEFONE_CONVENIENCIA = "";

interface ReciboTermicoProps {
  venda: VendaCompleta;
}

interface ConteudoCupomProps {
  venda: VendaCompleta;
}

function ConteudoCupom({ venda }: ConteudoCupomProps) {
  const data = new Date(venda.created_at);
  const dataFormatada = data.toLocaleDateString("pt-BR");
  const horaFormatada = data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const numeroVenda = venda.id.slice(0, 8).toUpperCase();

  const subtotal = venda.itens.reduce((s, i) => s + i.quantidade * i.preco_unitario, 0);
  const desconto = venda.desconto ?? 0;

  const mostrarCliente = !!venda.cliente_nome;

  return (
    <div className="font-mono text-sm leading-relaxed text-black">
      <div className="flex flex-col items-center gap-1 mb-3">
        <img src="/logo-auto-posto-uniao.jpeg" alt="" className="w-12 h-12 rounded" />
        <p className="font-bold text-lg leading-tight tracking-wide text-center">AUTO POSTO UNIÃO</p>
        <p className="text-xs font-medium">Conveniência</p>
        {ENDERECO_CONVENIENCIA && <p className="text-[11px] text-center leading-tight">{ENDERECO_CONVENIENCIA}</p>}
        {TELEFONE_CONVENIENCIA && <p className="text-[11px]">{TELEFONE_CONVENIENCIA}</p>}
      </div>

      <div className="border-t-2 border-dashed border-black my-2" />

      <p className="text-center font-bold">CUPOM NÃO FISCAL</p>
      <div className="flex flex-col gap-0.5 mt-2 text-xs">
        <div className="flex justify-between">
          <span className="font-semibold">Venda nº:</span>
          <span>{numeroVenda}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-semibold">Data:</span>
          <span>{dataFormatada}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-semibold">Hora:</span>
          <span>{horaFormatada}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-semibold">Operador:</span>
          <span>{venda.funcionario_nome}</span>
        </div>
      </div>

      {mostrarCliente && (
        <div className="border-2 border-black rounded mt-2 p-2">
          <p className="text-xs font-bold uppercase tracking-wide mb-1">
            {venda.forma_pagamento === "fiado" ? "Cliente (fiado)" : "Cliente"}
          </p>
          <p className="text-sm font-semibold">{venda.cliente_nome}</p>
          {venda.cliente_telefone && <p className="text-xs">{venda.cliente_telefone}</p>}
        </div>
      )}

      <div className="border-t-2 border-dashed border-black my-2" />

      <p className="text-xs font-bold mb-1.5">PRODUTOS</p>
      <div className="flex flex-col gap-2.5">
        {venda.itens.map((item, i) => (
          <div key={i}>
            <p className="font-semibold leading-snug break-words">{item.produto_nome}</p>
            <div className="flex justify-between text-xs pl-2 mt-0.5">
              <span>
                {item.quantidade} x R$ {item.preco_unitario.toFixed(2)}
              </span>
              <span className="font-semibold">R$ {(item.quantidade * item.preco_unitario).toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t-2 border-dashed border-black my-2" />

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-sm">
          <span className="font-medium">Subtotal</span>
          <span>R$ {subtotal.toFixed(2)}</span>
        </div>
        {desconto > 0 && (
          <div className="flex justify-between text-sm">
            <span className="font-medium">Desconto</span>
            <span>- R$ {desconto.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between items-baseline mt-1 pt-1 border-t border-black">
          <span className="font-bold text-lg">TOTAL</span>
          <span className="font-bold text-2xl">R$ {venda.total.toFixed(2)}</span>
        </div>
      </div>

      <div className="flex justify-between text-xs mt-2 font-semibold">
        <span>Forma de pagamento:</span>
        <span>{ROTULOS_PAGAMENTO[venda.forma_pagamento] ?? venda.forma_pagamento}</span>
      </div>

      {venda.forma_pagamento === "dinheiro" && venda.valor_recebido != null && (
        <div className="flex flex-col gap-0.5 text-xs mt-1">
          <div className="flex justify-between">
            <span className="font-semibold">Valor recebido:</span>
            <span>R$ {venda.valor_recebido.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-bold text-sm">
            <span>Troco:</span>
            <span>R$ {(venda.troco ?? 0).toFixed(2)}</span>
          </div>
        </div>
      )}

      {venda.cancelada && (
        <p className="text-center font-bold mt-3 border-2 border-black py-1.5 text-base">VENDA CANCELADA</p>
      )}

      {mostrarCliente && (
        <div className="mt-4">
          <div className="border-t border-black w-full" />
          <p className="text-center text-[11px] mt-1">Assinatura do cliente</p>
        </div>
      )}

      <div className="border-t-2 border-dashed border-black my-2" />
      <div className="text-center mt-2">
        <p className="text-xs font-semibold">Obrigado pela preferência!</p>
        <p className="text-xs font-semibold">Volte sempre!</p>
      </div>
    </div>
  );
}

export function ReciboTermico({ venda }: ReciboTermicoProps) {
  const [visualizando, setVisualizando] = useState(false);

  return (
    <div>
      <style>{`
        @media print {
          @page { size: auto; margin: 0; }
          body * { visibility: hidden; }
          #recibo-termico, #recibo-termico * { visibility: visible; }
          #recibo-termico { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>

      <div id="recibo-termico" className="mx-auto bg-white p-4" style={{ width: "80mm", maxWidth: "100%" }}>
        <ConteudoCupom venda={venda} />
      </div>

      <button
        onClick={() => setVisualizando(true)}
        className="mt-4 h-12 px-6 rounded-xl bg-slate-900 text-white font-semibold mx-auto flex items-center gap-2 print:hidden"
      >
        <Eye className="w-4 h-4" />
        Visualizar impressão
      </button>

      {visualizando && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl shadow-elevated w-full max-w-sm max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 shrink-0">
              <p className="font-semibold text-slate-900">Pré-visualização</p>
              <button
                onClick={() => setVisualizando(false)}
                aria-label="Fechar"
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
              <div className="bg-white p-4 mx-auto shadow-card" style={{ width: "80mm", maxWidth: "100%" }}>
                <ConteudoCupom venda={venda} />
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 shrink-0">
              <button
                onClick={() => window.print()}
                className="w-full h-12 rounded-xl bg-slate-900 text-white font-semibold"
              >
                Imprimir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}