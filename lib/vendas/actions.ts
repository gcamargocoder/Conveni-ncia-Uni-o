"use server";

import { verificarAcesso } from "@/lib/auth/servidor";
import { headers } from "next/headers";
import { processarVendaRecebida } from "@/services/vendas-sincronizadas.service";
import { gerarUuid } from "@/lib/utils/uuid";
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
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erroGeral: acesso.erro };
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
    // Os preços do carrinho vêm do navegador: o servidor confere contra o cadastro.
    const vendaId = gerarUuid();
    const resultado = await processarVendaRecebida(
      vendaId,
      {
        funcionario_id: auth.funcionario.id,
        forma_pagamento: formaPagamento,
        dispositivo,
        itens: itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, preco_unitario: i.preco_unitario })),
      },
      acesso.sessao.usuario.id
    );
    if (resultado.status === "registrada") return { sucesso: true, vendaId };
    const motivos = resultado.status === "rejeitada" ? [] : resultado.motivos.map((m) => m.mensagem);
    return {
      sucesso: false,
      erroGeral: ["Venda retida para revisão do administrador (os valores não conferem com o cadastro).", ...motivos].join(" "),
    };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}