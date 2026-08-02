"use client";

import { VendaCompleta } from "@/services/vendas.service";

const ROTULOS_PAGAMENTO: Record<string, string> = {
  dinheiro: "Dinheiro",
  debito: "Cartão de Débito",
  credito: "Cartão de Crédito",
  pix: "PIX",
};

interface ReciboTermicoProps {
  venda: VendaCompleta;
}

export function ReciboTermico({ venda }: ReciboTermicoProps) {
  const data = new Date(venda.created_at);
  const dataFormatada = data.toLocaleDateString("pt-BR");
  const horaFormatada = data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const numeroVenda = venda.id.slice(0, 8).toUpperCase();

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

      <div
        id="recibo-termico"
        className="font-mono text-sm leading-relaxed mx-auto bg-white p-4 text-black"
        style={{ width: "80mm", maxWidth: "100%" }}
      >
        <div className="flex flex-col items-center gap-1 mb-3">
          <img src="/logo-auto-posto-uniao.jpeg" alt="" className="w-12 h-12 rounded" />
          <p className="font-bold text-base leading-tight tracking-wide">AUTO POSTO UNIÃO</p>
          <p className="text-xs font-medium">Conveniência</p>
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
            <span>
              {dataFormatada} às {horaFormatada}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold">Operador:</span>
            <span>{venda.funcionario_nome}</span>
          </div>
        </div>

        <div className="border-t-2 border-dashed border-black my-2" />

        <p className="text-xs font-bold mb-1">PRODUTOS</p>
        <div className="flex flex-col gap-2">
          {venda.itens.map((item, i) => (
            <div key={i}>
              <p className="font-semibold leading-snug">{item.produto_nome}</p>
              <div className="flex justify-between text-xs pl-2">
                <span>
                  {item.quantidade} x R$ {item.preco_unitario.toFixed(2)}
                </span>
                <span className="font-semibold">R$ {(item.quantidade * item.preco_unitario).toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t-2 border-dashed border-black my-2" />

        <div className="flex justify-between items-baseline">
          <span className="font-bold text-lg">TOTAL</span>
          <span className="font-bold text-xl">R$ {venda.total.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-xs mt-1.5">
          <span className="font-semibold">Forma de pagamento:</span>
          <span>{ROTULOS_PAGAMENTO[venda.forma_pagamento] ?? venda.forma_pagamento}</span>
        </div>

        {venda.cancelada && (
          <p className="text-center font-bold mt-3 border-2 border-black py-1.5 text-base">VENDA CANCELADA</p>
        )}

        <div className="border-t-2 border-dashed border-black my-2" />
        <p className="text-center text-xs font-medium mt-2">Obrigado pela preferência!</p>
      </div>

      <button
        onClick={() => window.print()}
        className="mt-4 h-12 px-6 rounded-xl bg-slate-900 text-white font-semibold mx-auto block print:hidden"
      >
        Imprimir cupom
      </button>
    </div>
  );
}