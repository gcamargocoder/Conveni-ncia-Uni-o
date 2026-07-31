"use server";

import { revalidatePath } from "next/cache";
import { criarFornecedor } from "@/services/fornecedores.service";

export async function criarFornecedorAction(input: {
  nome: string;
  telefone?: string;
  cnpj_cpf?: string;
}) {
  if (!input.nome || input.nome.trim().length < 2) {
    return { sucesso: false, erro: "Nome deve ter pelo menos 2 caracteres." };
  }

  try {
    await criarFornecedor(input);
    revalidatePath("/fornecedores");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}
