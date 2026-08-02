"use server";

import { registrarVenda } from "@/services/vendas.service";
import { FormaPagamento } from "@/types/venda";

export interface PayloadVendaFila {
  funcionario_id: string;
  forma_pagamento: FormaPagamento;
  total: number;
  dispositivo?: string;
  terminal?: string;
  itens: { produto_id: string; quantidade: number; preco_unitario: number }[];
  cliente_id?: string | null;
}

export interface ResultadoSincronizarVenda {
  sucesso: boolean;
  jaExistia?: boolean;
  erro?: string;
}

export async function sincronizarVendaAction(
  id: string,
  payload: PayloadVendaFila
): Promise<ResultadoSincronizarVenda> {
  if (!id || !payload.funcionario_id || !payload.forma_pagamento) {
    return { sucesso: false, erro: "Payload de venda incompleto — não enviado." };
  }
  if (!Array.isArray(payload.itens) || payload.itens.length === 0) {
    return { sucesso: false, erro: "Venda sem itens — não enviada." };
  }
  if (payload.forma_pagamento === "fiado" && !payload.cliente_id) {
    return { sucesso: false, erro: "Venda fiado sem cliente — não enviada." };
  }

  try {
    const resultado = await registrarVenda({
      id,
      funcionario_id: payload.funcionario_id,
      forma_pagamento: payload.forma_pagamento,
      dispositivo: payload.dispositivo,
      cliente_id: payload.cliente_id,
      itens: payload.itens.map((i) => ({
        produto_id: i.produto_id,
        nome: "",
        quantidade: i.quantidade,
        preco_unitario: i.preco_unitario,
      })),
    });
    return { sucesso: true, jaExistia: resultado.jaExistia };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}