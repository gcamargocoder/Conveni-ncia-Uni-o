import { ItemCarrinho } from "./carrinho";
import { FormaPagamento } from "@/types/venda";

export interface ErroValidacaoVenda {
  campo: string;
  mensagem: string;
}

const FORMAS_VALIDAS: FormaPagamento[] = ["dinheiro", "debito", "credito", "pix"];

/**
 * De propósito, esta validação NUNCA checa estoque disponível.
 * Princípio do projeto: a venda nunca pode ser impedida. Estoque
 * negativo é tratado como alerta em outro lugar (dashboard/relatório),
 * nunca como bloqueio aqui.
 */
export function validarVenda(
  itens: ItemCarrinho[],
  formaPagamento: FormaPagamento
): ErroValidacaoVenda[] {
  const erros: ErroValidacaoVenda[] = [];

  if (itens.length === 0) {
    erros.push({ campo: "itens", mensagem: "Carrinho vazio — adicione ao menos um item." });
  }

  if (!FORMAS_VALIDAS.includes(formaPagamento)) {
    erros.push({ campo: "forma_pagamento", mensagem: "Forma de pagamento inválida." });
  }

  return erros;
}
