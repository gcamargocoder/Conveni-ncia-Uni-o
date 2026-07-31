"use server";

import { revalidatePath } from "next/cache";
import { criarCategoria } from "@/services/categorias.service";

export async function criarCategoriaAction(nome: string) {
  if (!nome || nome.trim().length < 2) {
    return { sucesso: false, erro: "Nome deve ter pelo menos 2 caracteres." };
  }

  try {
    const categoria = await criarCategoria(nome.trim());
    revalidatePath("/produtos");
    return { sucesso: true, categoria };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}
