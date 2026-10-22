"use server";

import { verificarAcesso } from "@/lib/auth/servidor";
import { autorizarPorPin } from "@/lib/auth/autorizacao";
import { revalidatePath } from "next/cache";
import { criarFornecedor, atualizarFornecedor, Fornecedor } from "@/services/fornecedores.service";
import { validarFornecedor, DadosFornecedor } from "@/lib/fornecedores/validacao";

export interface ResultadoAcaoFornecedor {
  sucesso: boolean;
  erros?: { campo: string; mensagem: string }[];
  erroGeral?: string;
  fornecedor?: Fornecedor;
  /** Preenchido quando o PIN/cargo não autoriza a operação (a tela mantém o pedido de PIN aberto). */
  erroAutorizacao?: string;
}

async function negar(pin: string): Promise<ResultadoAcaoFornecedor | null> {
  const autorizacao = await autorizarPorPin(pin, "produtos.editar");
  if (autorizacao.ok) return null;
  return { sucesso: false, erroGeral: autorizacao.erro, erroAutorizacao: autorizacao.erro };
}

export async function criarFornecedorAction(dados: DadosFornecedor, pinAutorizador: string): Promise<ResultadoAcaoFornecedor> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erroGeral: acesso.erro };
  const negado = await negar(pinAutorizador);
  if (negado) return negado;
  const erros = validarFornecedor(dados);
  if (erros.length > 0) return { sucesso: false, erros };

  try {
    const fornecedor = await criarFornecedor(dados);
    revalidatePath("/fornecedores");
    return { sucesso: true, fornecedor };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}

export async function atualizarFornecedorAction(
  id: string,
  dados: DadosFornecedor,
  pinAutorizador: string
): Promise<ResultadoAcaoFornecedor> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erroGeral: acesso.erro };
  const negado = await negar(pinAutorizador);
  if (negado) return negado;
  const erros = validarFornecedor(dados);
  if (erros.length > 0) return { sucesso: false, erros };

  try {
    await atualizarFornecedor(id, dados);
    revalidatePath("/fornecedores");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}