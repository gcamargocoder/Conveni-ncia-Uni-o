"use server";

import { revalidatePath } from "next/cache";
import {
  criarFuncionario,
  listarFuncionarios,
  buscarFuncionarioPorId,
  atualizarFuncionario,
  excluirFuncionario,
} from "@/services/funcionarios.service";
import { validarPinAction } from "@/lib/auth/actions";
import { possuiPermissao, podeGerenciarFuncionario } from "@/lib/auth/permissoes";
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

export async function atualizarFuncionarioAction(
  id: string,
  dados: { nome?: string; cargo?: Cargo; pin?: string },
  pinAutorizador: string
) {
  const auth = await validarPinAction(pinAutorizador);
  if (!auth.sucesso || !auth.funcionario) {
    return { sucesso: false, erro: "PIN de autorização inválido." };
  }

  const alvo = await buscarFuncionarioPorId(id);
  if (!alvo) return { sucesso: false, erro: "Funcionário não encontrado." };

  if (!podeGerenciarFuncionario(auth.funcionario.cargo, alvo.cargo)) {
    return { sucesso: false, erro: "Seu cargo não pode editar esse funcionário." };
  }

  if (dados.nome !== undefined && dados.nome.trim().length < 2) {
    return { sucesso: false, erro: "Nome deve ter pelo menos 2 caracteres." };
  }
  if (dados.pin !== undefined && !validarFormatoPin(dados.pin)) {
    return { sucesso: false, erro: "PIN deve ter 4 dígitos." };
  }
  if (dados.cargo !== undefined && !podeGerenciarFuncionario(auth.funcionario.cargo, dados.cargo)) {
    return { sucesso: false, erro: "Seu cargo não pode atribuir esse cargo." };
  }

  try {
    await atualizarFuncionario(id, dados);
    revalidatePath("/funcionarios");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}

export async function excluirFuncionarioAction(id: string, pinAutorizador: string) {
  const auth = await validarPinAction(pinAutorizador);
  if (!auth.sucesso || !auth.funcionario) {
    return { sucesso: false, erro: "PIN de autorização inválido." };
  }

  const alvo = await buscarFuncionarioPorId(id);
  if (!alvo) return { sucesso: false, erro: "Funcionário não encontrado." };

  if (alvo.id === auth.funcionario.id) {
    return { sucesso: false, erro: "Você não pode excluir seu próprio cadastro." };
  }

  if (!podeGerenciarFuncionario(auth.funcionario.cargo, alvo.cargo)) {
    return { sucesso: false, erro: "Seu cargo não pode excluir esse funcionário." };
  }

  try {
    await excluirFuncionario(id);
    revalidatePath("/funcionarios");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}