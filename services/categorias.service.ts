import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";

export interface Categoria {
  id: string;
  nome: string;
  ativo: boolean;
  updated_at?: string;
}

const CAMPOS = { id: true, nome: true, ativo: true } as const;

export async function listarCategorias(): Promise<Categoria[]> {
  return executar(
    () =>
      prisma.categoria.findMany({
        select: CAMPOS,
        where: { deleted_at: null },
        orderBy: { nome: "asc" },
        take: 500,
      }),
    "Erro ao listar categorias"
  );
}

export async function listarCategoriasAlteradasDesde(desde: Date | null): Promise<Categoria[]> {
  return executar(
    () =>
      prisma.categoria.findMany({
        select: { ...CAMPOS, updated_at: true },
        where: desde ? { updated_at: { gte: desde } } : undefined,
        orderBy: { updated_at: "asc" },
        take: 500,
      }),
    "Erro ao sincronizar categorias"
  );
}

export async function criarCategoria(nome: string): Promise<Categoria> {
  return executar(() => prisma.categoria.create({ data: { nome }, select: CAMPOS }), "Erro ao criar categoria");
}

export async function atualizarCategoria(id: string, nome: string): Promise<Categoria> {
  return executar(
    () => prisma.categoria.update({ where: { id }, data: { nome }, select: CAMPOS }),
    "Erro ao atualizar categoria"
  );
}

export async function excluirCategoria(id: string): Promise<void> {
  const temProdutos = await executar<{ id: string } | null>(
    () => prisma.produto.findFirst({ where: { categoria_id: id }, select: { id: true } }),
    "Erro ao verificar produtos da categoria"
  );

  if (temProdutos) {
    throw new Error(
      "Esta categoria tem produtos cadastrados nela e não pode ser excluída — mude a categoria desses produtos primeiro, ou edite o nome em vez de excluir."
    );
  }

  await executar(() => prisma.categoria.delete({ where: { id } }), "Erro ao excluir categoria");
}
