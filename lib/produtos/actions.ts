"use server";

import { revalidatePath } from "next/cache";
import { criarProduto, atualizarProduto, desativarProduto } from "@/services/produtos.service";
import { validarProduto, DadosProduto } from "@/lib/produtos/validacao";

export interface ResultadoAcaoProduto {
  sucesso: boolean;
  erros?: { campo: string; mensagem: string }[];
  erroGeral?: string;
}

export async function criarProdutoAction(dados: DadosProduto): Promise<ResultadoAcaoProduto> {
  const erros = validarProduto(dados);
  if (erros.length > 0) return { sucesso: false, erros };

  try {
    await criarProduto(dados);
    revalidatePath("/produtos");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}

export async function atualizarProdutoAction(
  id: string,
  dados: DadosProduto
): Promise<ResultadoAcaoProduto> {
  const erros = validarProduto(dados);
  if (erros.length > 0) return { sucesso: false, erros };

  try {
    await atualizarProduto(id, dados);
    revalidatePath("/produtos");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}

export async function desativarProdutoAction(id: string): Promise<ResultadoAcaoProduto> {
  try {
    await desativarProduto(id);
    revalidatePath("/produtos");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}
