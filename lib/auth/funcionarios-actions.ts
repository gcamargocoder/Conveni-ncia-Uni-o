"use server";

import { revalidatePath } from "next/cache";
import { criarFuncionario, listarFuncionarios } from "@/services/funcionarios.service";
import { validarPinAction } from "@/lib/auth/actions";
import { possuiPermissao } from "@/lib/auth/permissoes";
import { validarFormatoPin } from "@/lib/auth/pin";
import { Cargo } from "@/types/funcionario";

export async function criarFuncionarioAction(
  input: { nome: string; cargo: Cargo; pin: string },
  pinAutorizador: string
) {
  const auth = await validarPinAction(pinAutorizador);
  if (!auth.sucesso || !auth.funcionario) {
    return { sucesso: false, erro: "PIN de autorização inválido." };
  }

  if (!possuiPermissao(auth.funcionario.cargo, "funcionarios.gerenciar")) {
    return { sucesso: false, erro: "Seu cargo não pode cadastrar funcionários." };
  }

  if (!input.nome || input.nome.trim().length < 2) {
    return { sucesso: false, erro: "Nome deve ter pelo menos 2 caracteres." };
  }

  if (!validarFormatoPin(input.pin)) {
    return { sucesso: false, erro: "PIN do novo funcionário deve ter 4 dígitos." };
  }

  try {
    await criarFuncionario(input);
    revalidatePath("/funcionarios");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}

export async function listarFuncionariosAction() {
  return listarFuncionarios();
}
