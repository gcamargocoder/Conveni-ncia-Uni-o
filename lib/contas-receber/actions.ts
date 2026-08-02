"use server";

import { revalidatePath } from "next/cache";
import { registrarPagamento, buscarConta, DetalheContaReceber } from "@/services/contas-receber.service";
import { validarPagamento, DadosFormPagamento } from "@/lib/contas-receber/validacao";
import { validarPinAction } from "@/lib/auth/actions";

export async function buscarContaAction(id: string): Promise<DetalheContaReceber | null> {
  return buscarConta(id);
}

export interface ResultadoAcaoPagamento {
  sucesso: boolean;
  erro?: string;
  saldoAtual?: number;
  status?: string;
}

export async function registrarPagamentoAction(
  contaReceberId: string,
  dados: DadosFormPagamento,
  saldoAtual: number,
  pin: string
): Promise<ResultadoAcaoPagamento> {
  const erros = validarPagamento(dados, saldoAtual);
  if (erros.length > 0) {
    return { sucesso: false, erro: erros[0].mensagem };
  }

  const auth = await validarPinAction(pin);
  if (!auth.sucesso || !auth.funcionario) {
    return { sucesso: false, erro: "PIN inválido." };
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