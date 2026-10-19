import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";
import { DadosCliente } from "@/lib/clientes/validacao";
import { Cliente } from "@/types/cliente";

const LIMITE_LISTAGEM = 500;

export async function listarClientesAlteradosDesde(desde: Date | null): Promise<Cliente[]> {
  return executar(
    () =>
      prisma.cliente.findMany({
        where: desde ? { updated_at: { gte: desde } } : undefined,
        orderBy: { updated_at: "asc" },
        take: LIMITE_LISTAGEM,
      }),
    "Erro ao sincronizar clientes"
  );
}

export async function listarClientes(): Promise<Cliente[]> {
  return executar(
    () =>
      prisma.cliente.findMany({
        where: { deleted_at: null },
        orderBy: { nome: "asc" },
        take: LIMITE_LISTAGEM,
      }),
    "Erro ao listar clientes"
  );
}

export async function buscarCliente(id: string): Promise<Cliente | null> {
  try {
    return await executar<Cliente | null>(() => prisma.cliente.findUnique({ where: { id } }), "Erro ao buscar cliente");
  } catch {
    return null;
  }
}

export async function criarCliente(dados: DadosCliente): Promise<Cliente> {
  return executar(() => prisma.cliente.create({ data: dados }), "Erro ao criar cliente");
}

export async function atualizarCliente(id: string, dados: DadosCliente): Promise<Cliente> {
  return executar(() => prisma.cliente.update({ where: { id }, data: dados }), "Erro ao atualizar cliente");
}

export async function desativarCliente(id: string): Promise<void> {
  await executar(
    () => prisma.cliente.update({ where: { id }, data: { deleted_at: new Date(), ativo: false } }),
    "Erro ao desativar cliente"
  );
}

export async function excluirCliente(id: string): Promise<void> {
  const temVendas = await executar<{ id: string } | null>(
    () => prisma.venda.findFirst({ where: { cliente_id: id }, select: { id: true } }),
    "Erro ao verificar vendas do cliente"
  );

  if (temVendas) {
    throw new Error(
      'Este cliente já aparece em vendas registradas (histórico) e não pode ser excluído — use "Desativar" para escondê-lo das listas sem perder o histórico.'
    );
  }

  await executar(() => prisma.cliente.delete({ where: { id } }), "Erro ao excluir cliente");
}
