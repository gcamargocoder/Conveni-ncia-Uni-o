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
}

export interface ResultadoSincronizarVenda {
  sucesso: boolean;
  /** true quando a venda já existia no servidor — conflito resolvido
   *  pela idempotência, não um erro (Fase 6.5: auditoria de conflitos). */
  jaExistia?: boolean;
  erro?: string;
}

/**
 * Diferente de finalizarVendaAction (lib/vendas/actions.ts): esta
 * Server Action NÃO pede PIN. O worker de sincronização não tem (e não
 * deveria ter) o PIN — ele já foi validado uma única vez, no momento
 * da venda, pelo operador. O funcionario_id já autenticado naquela
 * hora viaja dentro do payload da fila.
 */
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

  try {
    const resultado = await registrarVenda({
      id,
      funcionario_id: payload.funcionario_id,
      forma_pagamento: payload.forma_pagamento,
      dispositivo: payload.dispositivo,
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