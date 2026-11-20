"use server";

import { verificarAcesso } from "@/lib/auth/servidor";
import { prisma } from "@/services/prisma/client";
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
  pin: string,
  caixaId: string
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

  // Venda presencial exige caixa ABERTO: o terminal é o do caixa informado.
  const caixa = await prisma.caixa.findUnique({ where: { id: caixaId }, select: { status: true, terminal_id: true } }).catch(() => null);
  if (!caixa || caixa.status !== "aberto") {
    return { sucesso: false, erroGeral: "Abra o caixa antes de finalizar a venda." };
  }

  try {
    const dispositivo = caixa.terminal_id;
    // Os preços do carrinho vêm do navegador: o servidor confere contra o cadastro.
    const vendaId = gerarUuid();
    const resultado = await processarVendaRecebida(
      vendaId,
      {
        funcionario_id: auth.funcionario.id,
        forma_pagamento: formaPagamento,
        dispositivo,
        caixa_id: caixaId,
        origem: "online",
        itens: itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, preco_unitario: i.preco_unitario })),
      },
      acesso.sessao.usuario.id
    );
    if (resultado.status === "registrada") return { sucesso: true, vendaId };
    if (resultado.status === "aguardando_caixa") return { sucesso: false, erroGeral: "Caixa não encontrado." };
    const motivos = resultado.status === "rejeitada" ? [] : resultado.motivos.map((m) => m.mensagem);
    return {
      sucesso: false,
      erroGeral: ["Venda retida para revisão do administrador (os valores não conferem com o cadastro).", ...motivos].join(" "),
    };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}