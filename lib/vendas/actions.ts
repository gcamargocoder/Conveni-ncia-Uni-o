"use server";

import { headers } from "next/headers";
import { registrarVenda } from "@/services/vendas.service";
import { validarVenda } from "@/lib/vendas/validacao";
import { ItemCarrinho } from "@/lib/vendas/carrinho";
import { FormaPagamento } from "@/types/venda";
import { validarPinAction } from "@/lib/auth/actions";
import { possuiPermissao } from "@/lib/auth/permissoes";

export interface ResultadoFinalizarVenda {
  sucesso: boolean;
  vendaId?: string;
  erros?: { campo: string; mensagem: string }[];
  erroGeral?: string;
}

export async function finalizarVendaAction(
  itens: ItemCarrinho[],
  formaPagamento: FormaPagamento,
  pin: string
): Promise<ResultadoFinalizarVenda> {
  const erros = validarVenda(itens, formaPagamento);
  if (erros.length > 0) return { sucesso: false, erros };

  const auth = await validarPinAction(pin);
  if (!auth.sucesso || !auth.funcionario) {
    return { sucesso: false, erroGeral: "PIN inválido." };
  }

  if (!possuiPermissao(auth.funcionario.cargo, "pdv.vender")) {
    return { sucesso: false, erroGeral: "Seu cargo não tem permissão para vender." };
  }

  try {
    const dispositivo = (await headers()).get("user-agent") ?? undefined;
    const resultado = await registrarVenda({
      funcionario_id: auth.funcionario.id,
      forma_pagamento: formaPagamento,
      itens,
      dispositivo,
    });
    return { sucesso: true, vendaId: resultado.id };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}