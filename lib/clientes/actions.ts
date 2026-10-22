"use server";

import { verificarAcesso } from "@/lib/auth/servidor";
import { autorizarPorPin } from "@/lib/auth/autorizacao";

import { revalidatePath } from "next/cache";
import { criarCliente, atualizarCliente, desativarCliente, excluirCliente } from "@/services/clientes.service";
import { validarCliente, DadosCliente } from "@/lib/clientes/validacao";
import type { Cliente } from "@/types/cliente";

export interface ResultadoAcaoCliente {
  sucesso: boolean;
  erros?: { campo: string; mensagem: string }[];
  erroGeral?: string;
  cliente?: Cliente;
  /** PIN incorreto/bloqueado ou cargo sem permissão para cadastrar clientes. */
  erroAutorizacao?: string;
}

// Consultar e selecionar clientes (PDV, listas) exige só a sessão de login. Criar, editar, desativar e
// excluir são operações administrativas: o servidor exige o PIN de um cargo com "clientes.gerenciar".
async function negar(pin: string): Promise<ResultadoAcaoCliente | null> {
  const autorizacao = await autorizarPorPin(pin, "clientes.gerenciar");
  if (autorizacao.ok) return null;
  return { sucesso: false, erroGeral: autorizacao.erro, erroAutorizacao: autorizacao.erro };
}

export async function criarClienteAction(dados: DadosCliente, pinAutorizador: string): Promise<ResultadoAcaoCliente> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erroGeral: acesso.erro };
  const recusa = await negar(pinAutorizador);
  if (recusa) return recusa;
  const erros = validarCliente(dados);
  if (erros.length > 0) return { sucesso: false, erros };

  try {
    const cliente = await criarCliente(dados);
    revalidatePath("/clientes");
    return { sucesso: true, cliente };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}

export async function atualizarClienteAction(
  id: string,
  dados: DadosCliente,
  pinAutorizador: string
): Promise<ResultadoAcaoCliente> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erroGeral: acesso.erro };
  const recusa = await negar(pinAutorizador);
  if (recusa) return recusa;
  const erros = validarCliente(dados);
  if (erros.length > 0) return { sucesso: false, erros };

  try {
    await atualizarCliente(id, dados);
    revalidatePath("/clientes");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}

export async function desativarClienteAction(id: string, pinAutorizador: string): Promise<ResultadoAcaoCliente> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erroGeral: acesso.erro };
  const recusa = await negar(pinAutorizador);
  if (recusa) return recusa;
  try {
    await desativarCliente(id);
    revalidatePath("/clientes");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}

export async function excluirClienteAction(id: string, pinAutorizador: string): Promise<ResultadoAcaoCliente> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erroGeral: acesso.erro };
  const recusa = await negar(pinAutorizador);
  if (recusa) return recusa;
  try {
    await excluirCliente(id);
    revalidatePath("/clientes");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}
