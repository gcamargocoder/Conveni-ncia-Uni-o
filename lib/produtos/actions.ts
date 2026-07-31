"use server";

import { revalidatePath } from "next/cache";
import { criarProduto, atualizarProduto, desativarProduto } from "@/services/produtos.service";
import { validarProduto, DadosProduto } from "@/lib/produtos/validacao";

export interface ResultadoAcaoProduto {
  sucesso: boolean;
  erros?: { campo: string; mensagem: string }[];
  erroGeral?: string;
}

function normalizarCodigoBarras(dados: DadosProduto): DadosProduto {
  const codigo = dados.codigo_barras?.trim();
  return { ...dados, codigo_barras: codigo ? codigo : null };
}

export async function criarProdutoAction(dados: DadosProduto): Promise<ResultadoAcaoProduto> {
  const dadosNormalizados = normalizarCodigoBarras(dados);
  const erros = validarProduto(dadosNormalizados);
  if (erros.length > 0) return { sucesso: false, erros };

  try {
    await criarProduto(dadosNormalizados);
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
  const dadosNormalizados = normalizarCodigoBarras(dados);
  const erros = validarProduto(dadosNormalizados);
  if (erros.length > 0) return { sucesso: false, erros };

  try {
    await atualizarProduto(id, dadosNormalizados);
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

/**
 * Diferente de atualizarProdutoAction (exige o formulário inteiro:
 * categoria, preços, etc.) — esta só troca o nome, usada no atalho
 * "Editar" da tela de Estoque, onde não faz sentido pedir o cadastro
 * completo de novo só para corrigir um nome.
 */
export async function renomearProdutoAction(id: string, novoNome: string): Promise<ResultadoAcaoProduto> {
  const nome = novoNome.trim();
  if (nome.length < 2) {
    return { sucesso: false, erros: [{ campo: "nome", mensagem: "Nome deve ter pelo menos 2 caracteres." }] };
  }

  try {
    await atualizarProduto(id, { nome });
    revalidatePath("/produtos");
    revalidatePath("/estoque");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}