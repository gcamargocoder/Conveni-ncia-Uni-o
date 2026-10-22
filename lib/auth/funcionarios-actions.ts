"use server";

import { verificarAcesso } from "@/lib/auth/servidor";
import { revalidatePath } from "next/cache";
import {
  criarFuncionario,
  buscarFuncionarioPorId,
  atualizarFuncionario,
  excluirFuncionario,
  contarProprietariosAtivos,
  pinEmUsoPorOutro,
  criarProprietarioInicial,
  ProprietarioJaConfiguradoError,
} from "@/services/funcionarios.service";
import { validarPinAction } from "@/lib/auth/actions";
import { possuiPermissao, podeGerenciarFuncionario } from "@/lib/auth/permissoes";
import { validarFormatoPin } from "@/lib/auth/pin";
import { Cargo } from "@/types/funcionario";

/**
 * Configuração inicial: cria o primeiro proprietário (e seu PIN administrativo). Só o administrador
 * da conta de login pode fazê-lo, e só enquanto não existir nenhum proprietário ativo — depois disso
 * o fluxo fica fechado e o PIN só muda pela edição de funcionário, autorizada por outro PIN.
 */
export async function configurarProprietarioInicialAction(input: { nome: string; pin: string; confirmacaoPin: string }) {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };

  if (!input.nome || input.nome.trim().length < 2) {
    return { sucesso: false, erro: "Nome deve ter pelo menos 2 caracteres." };
  }
  if (!validarFormatoPin(input.pin)) {
    return { sucesso: false, erro: "O PIN deve ter 4 dígitos." };
  }
  if (input.pin !== input.confirmacaoPin) {
    return { sucesso: false, erro: "A confirmação do PIN não confere." };
  }

  try {
    // Defesa extra: se já existir PIN de outro funcionário igual, a identificação ficaria ambígua.
    if (await pinEmUsoPorOutro(input.pin)) {
      return { sucesso: false, erro: "Esse PIN já está em uso. Escolha outro." };
    }
    const criado = await criarProprietarioInicial({ nome: input.nome.trim(), pin: input.pin });
    console.info(`[auth] proprietário inicial configurado funcionario=${criado.id} usuario=${acesso.sessao.usuario.id}`);
    revalidatePath("/funcionarios");
    return { sucesso: true };
  } catch (e) {
    if (e instanceof ProprietarioJaConfiguradoError) {
      return { sucesso: false, erro: "O proprietário já foi configurado. Use a edição de funcionários." };
    }
    return { sucesso: false, erro: (e as Error).message };
  }
}

export async function criarFuncionarioAction(
  input: { nome: string; cargo: Cargo; pin: string },
  pinAutorizador: string
) {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
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
    if (await pinEmUsoPorOutro(input.pin)) {
      return { sucesso: false, erro: "Esse PIN já está em uso por outro funcionário." };
    }
    await criarFuncionario(input);
    revalidatePath("/funcionarios");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}

export async function atualizarFuncionarioAction(
  id: string,
  dados: { nome?: string; cargo?: Cargo; pin?: string },
  pinAutorizador: string
) {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
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

  const trocaCargoDoProprietario = alvo.cargo === "proprietario" && dados.cargo !== undefined && dados.cargo !== "proprietario";
  if (trocaCargoDoProprietario && alvo.ativo && (await contarProprietariosAtivos()) <= 1) {
    return { sucesso: false, erro: "Não é possível rebaixar o único proprietário ativo." };
  }

  try {
    if (dados.pin !== undefined && (await pinEmUsoPorOutro(dados.pin, id))) {
      return { sucesso: false, erro: "Esse PIN já está em uso por outro funcionário." };
    }
    await atualizarFuncionario(id, dados);
    revalidatePath("/funcionarios");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}

export async function excluirFuncionarioAction(id: string, pinAutorizador: string) {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
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

  if (alvo.cargo === "proprietario" && alvo.ativo && (await contarProprietariosAtivos()) <= 1) {
    return { sucesso: false, erro: "Não é possível excluir o único proprietário ativo." };
  }

  try {
    await excluirFuncionario(id);
    revalidatePath("/funcionarios");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}