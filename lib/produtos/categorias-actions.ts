"use server";

import { revalidatePath } from "next/cache";
import { criarCategoria, atualizarCategoria, excluirCategoria } from "@/services/categorias.service";

export async function criarCategoriaAction(nome: string) {
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

export async function atualizarCategoriaAction(id: string, nome: string) {
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

export async function excluirCategoriaAction(id: string) {
  try {
    await excluirCategoria(id);
    revalidatePath("/produtos");
    revalidatePath("/categorias");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}