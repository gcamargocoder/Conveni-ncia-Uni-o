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
  const dataFormatada = new Date(venda.created_at).toLocaleString("pt-BR");

  return (
    <div>
      {/* @media print: some tudo fora do recibo, e o recibo vira a página inteira,
          no tamanho padrão de bobina térmica (80mm). */}
      <style>{`
        @media print {
          @page { size: 80mm auto; margin: 0; }
          body * { visibility: hidden; }
          #recibo-termico, #recibo-termico * { visibility: visible; }
          #recibo-termico { position: absolute; top: 0; left: 0; width: 80mm; }
        }
      `}</style>

      <div
        id="recibo-termico"
        className="font-mono text-sm mx-auto bg-white p-4"
        style={{ width: "80mm" }}
      >
        <div className="flex flex-col items-center gap-1 mb-2">
          {/* <img> puro (não next/image) — mantém o HTML simples para
              a impressão térmica, sem wrappers extras que o Next
              adicionaria e que poderiam bagunçar o layout de 80mm. */}
          <img src="/logo-auto-posto-uniao.jpeg" alt="" className="w-12 h-12 rounded" />
          <p className="font-bold text-base leading-tight">AUTO POSTO UNIÃO</p>
          <p className="text-xs text-slate-600">Conveniência</p>
        </div>

        <div className="border-t border-dashed border-black my-2" />

        <p className="text-center font-bold">CUPOM NÃO FISCAL</p>
        <p className="text-center text-xs">{dataFormatada}</p>
        <div className="border-t border-dashed border-black my-2" />

        {venda.itens.map((item, i) => (
          <div key={i} className="flex justify-between">
            <span>
              {item.quantidade}x {item.produto_nome}
            </span>
            <span>R$ {(item.quantidade * item.preco_unitario).toFixed(2)}</span>
          </div>
        ))}

        <div className="border-t border-dashed border-black my-2" />
        <div className="flex justify-between font-bold text-base">
          <span>TOTAL</span>
          <span>R$ {venda.total.toFixed(2)}</span>
        </div>
        <p className="text-xs mt-1">
          Pagamento: {ROTULOS_PAGAMENTO[venda.forma_pagamento] ?? venda.forma_pagamento}
        </p>

        {venda.cancelada && (
          <p className="text-center font-bold mt-3 border-2 border-black py-1">VENDA CANCELADA</p>
        )}

        <p className="text-center text-xs mt-4">Obrigado pela preferência!</p>
      </div>

      {/* Botão fora da área impressa (escondido no @media print acima) */}
      <button
        onClick={() => window.print()}
        className="mt-4 h-12 px-6 rounded-xl bg-slate-900 text-white font-semibold mx-auto block print:hidden"
      >
        Imprimir cupom
      </button>
    </div>
  );
}