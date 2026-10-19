import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";
import { DadosFornecedor } from "@/lib/fornecedores/validacao";

export interface Fornecedor {
  id: string;
  nome: string;
  razao_social: string | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  cnpj_cpf: string | null;
  endereco: string | null;
  cidade: string | null;
  estado: string | null;
  observacoes: string | null;
  ativo: boolean;
}

export async function listarFornecedores(): Promise<Fornecedor[]> {
  return executar(
    () => prisma.fornecedor.findMany({ where: { deleted_at: null }, orderBy: { nome: "asc" }, take: 500 }),
    "Erro ao listar fornecedores"
  );
}

export async function buscarFornecedorPorId(id: string): Promise<Fornecedor | null> {
  try {
    return await executar<Fornecedor | null>(
      () => prisma.fornecedor.findUnique({ where: { id } }),
      "Erro ao buscar fornecedor"
    );
  } catch {
    return null;
  }
}

export async function criarFornecedor(dados: DadosFornecedor): Promise<Fornecedor> {
  return executar(() => prisma.fornecedor.create({ data: dados }), "Erro ao criar fornecedor");
}

export async function atualizarFornecedor(id: string, dados: DadosFornecedor): Promise<Fornecedor> {
  return executar(() => prisma.fornecedor.update({ where: { id }, data: dados }), "Erro ao atualizar fornecedor");
}
