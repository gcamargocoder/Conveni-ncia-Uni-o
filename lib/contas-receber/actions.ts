"use server";

import { verificarAcesso } from "@/lib/auth/servidor";

import { revalidatePath } from "next/cache";
import {
  registrarPagamento,
  buscarConta,
  buscarDetalheCliente,
  DetalheContaReceber,
  DetalheCliente,
} from "@/services/contas-receber.service";
import { validarPagamento, DadosFormPagamento } from "@/lib/contas-receber/validacao";
import { autorizarPorPin } from "@/lib/auth/autorizacao";

export async function buscarContaAction(id: string): Promise<DetalheContaReceber | null> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return null;
  return buscarConta(id);
}

export async function buscarDetalheClienteAction(clienteId: string): Promise<DetalheCliente | null> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return null;
  return buscarDetalheCliente(clienteId);
}

export interface ResultadoAcaoPagamento {
  sucesso: boolean;
  erro?: string;
  saldoAtual?: number;
  status?: string;
  erroAutorizacao?: string;
}

export async function registrarPagamentoAction(
  contaReceberId: string,
  dados: DadosFormPagamento,
  saldoAtual: number,
  pin: string
): Promise<ResultadoAcaoPagamento> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
  const erros = validarPagamento(dados, saldoAtual);
  if (erros.length > 0) {
    return { sucesso: false, erro: erros[0].mensagem };
  }

  // Quem autoriza é o PIN de um cargo com "contas_receber.registrar_pagamento" (proprietário/gerente);
  // o PIN de caixa, frentista ou estoquista é recusado aqui, mesmo numa chamada direta da action.
  const auth = await autorizarPorPin(pin, "contas_receber.registrar_pagamento");
  if (!auth.ok) {
    return { sucesso: false, erro: auth.erro, erroAutorizacao: auth.erro };
  }

  try {
    const resultado = await registrarPagamento({
      contaReceberId,
      valor: dados.valor,
      formaPagamento: dados.formaPagamento,
      funcionarioId: auth.funcionario.id,
      observacoes: dados.observacoes,
    });
    revalidatePath("/contas-receber");
    return { sucesso: true, saldoAtual: resultado.saldoAtual, status: resultado.status };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}