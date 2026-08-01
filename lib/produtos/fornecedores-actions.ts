"use server";

import { revalidatePath } from "next/cache";
import { criarFornecedor, atualizarFornecedor } from "@/services/fornecedores.service";
import { validarFornecedor, DadosFornecedor } from "@/lib/fornecedores/validacao";

export interface ResultadoAcaoFornecedor {
  sucesso: boolean;
  erros?: { campo: string; mensagem: string }[];
  erroGeral?: string;
}

export async function criarFornecedorAction(dados: DadosFornecedor): Promise<ResultadoAcaoFornecedor> {
  const erros = validarFornecedor(dados);
  if (erros.length > 0) return { sucesso: false, erros };

  try {
    await criarFornecedor(dados);
    revalidatePath("/fornecedores");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}

export async function atualizarFornecedorAction(
  id: string,
  dados: DadosFornecedor
): Promise<ResultadoAcaoFornecedor> {
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