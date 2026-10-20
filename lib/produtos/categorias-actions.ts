"use server";

import { verificarAcesso } from "@/lib/auth/servidor";
import { revalidatePath } from "next/cache";
import { criarCategoria, atualizarCategoria, excluirCategoria } from "@/services/categorias.service";

export async function criarCategoriaAction(nome: string) {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
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
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
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
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
  try {
    await excluirCategoria(id);
    revalidatePath("/produtos");
    revalidatePath("/categorias");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}