"use server";

import { verificarAcesso } from "@/lib/auth/servidor";
import { autorizarPorPin } from "@/lib/auth/autorizacao";
import { revalidatePath } from "next/cache";
import { criarCategoria, atualizarCategoria, excluirCategoria, Categoria } from "@/services/categorias.service";

export interface ResultadoAcaoCategoria {
  sucesso: boolean;
  erro?: string;
  categoria?: Categoria;
  /** Preenchido quando o PIN/cargo não autoriza a operação (a tela mantém o pedido de PIN aberto). */
  erroAutorizacao?: string;
}

async function negar(pin: string): Promise<ResultadoAcaoCategoria | null> {
  const autorizacao = await autorizarPorPin(pin, "produtos.editar");
  if (autorizacao.ok) return null;
  return { sucesso: false, erro: autorizacao.erro, erroAutorizacao: autorizacao.erro };
}

export async function criarCategoriaAction(nome: string, pinAutorizador: string): Promise<ResultadoAcaoCategoria> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
  const negado = await negar(pinAutorizador);
  if (negado) return negado;
  if (!nome || nome.trim().length < 2) {
    return { sucesso: false, erro: "Nome deve ter pelo menos 2 caracteres." };
  }

  try {
    const categoria = await criarCategoria(nome.trim());
    revalidatePath("/produtos");
    revalidatePath("/categorias");
    return { sucesso: true, categoria };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}

export async function atualizarCategoriaAction(id: string, nome: string, pinAutorizador: string): Promise<ResultadoAcaoCategoria> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
  const negado = await negar(pinAutorizador);
  if (negado) return negado;
  if (!nome || nome.trim().length < 2) {
    return { sucesso: false, erro: "Nome deve ter pelo menos 2 caracteres." };
  }

  try {
    const categoria = await atualizarCategoria(id, nome.trim());
    revalidatePath("/produtos");
    revalidatePath("/categorias");
    return { sucesso: true, categoria };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}

export async function excluirCategoriaAction(id: string, pinAutorizador: string): Promise<ResultadoAcaoCategoria> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
  const negado = await negar(pinAutorizador);
  if (negado) return negado;
  try {
    await excluirCategoria(id);
    revalidatePath("/produtos");
    revalidatePath("/categorias");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}