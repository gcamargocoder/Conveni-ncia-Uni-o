"use server";

import { revalidatePath } from "next/cache";
import { criarCliente, atualizarCliente, desativarCliente, excluirCliente } from "@/services/clientes.service";
import { validarCliente, DadosCliente } from "@/lib/clientes/validacao";
import type { Cliente } from "@/types/cliente";

export interface ResultadoAcaoCliente {
  sucesso: boolean;
  erros?: { campo: string; mensagem: string }[];
  erroGeral?: string;
  cliente?: Cliente;
}

export async function criarClienteAction(dados: DadosCliente): Promise<ResultadoAcaoCliente> {
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

export async function atualizarClienteAction(id: string, dados: DadosCliente): Promise<ResultadoAcaoCliente> {
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

export async function desativarClienteAction(id: string): Promise<ResultadoAcaoCliente> {
  try {
    await desativarCliente(id);
    revalidatePath("/clientes");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}

export async function excluirClienteAction(id: string): Promise<ResultadoAcaoCliente> {
  try {
    await excluirCliente(id);
    revalidatePath("/clientes");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}