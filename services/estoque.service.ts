import { Prisma } from "@prisma/client";
import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";
import { DadosMovimentacao } from "@/lib/estoque/movimentacao";

export interface EstoqueAtual {
  produto_id: string;
  nome: string;
  codigo_barras: string | null;
  categoria_nome: string | null;
  fornecedor_nome: string | null;
  estoque_minimo: number;
  quantidade_atual: number;
}

const LIMITE_LISTAGEM = 1000;

const COLUNAS_ESTOQUE = Prisma.sql`produto_id, nome, codigo_barras, categoria_nome, fornecedor_nome, estoque_minimo, quantidade_atual`;

export async function registrarMovimentacao(dados: DadosMovimentacao): Promise<void> {
  await executar(() => prisma.movimentacaoEstoque.create({ data: dados }), "Erro ao registrar movimentação");
}

export async function listarEstoqueAtual(): Promise<EstoqueAtual[]> {
  return executar(
    () => prisma.$queryRaw`
      SELECT ${COLUNAS_ESTOQUE} FROM estoque_atual ORDER BY nome LIMIT ${LIMITE_LISTAGEM}`,
    "Erro ao consultar estoque"
  );
}

export async function listarProdutosAbaixoDoMinimo(): Promise<EstoqueAtual[]> {
  return executar(
    () => prisma.$queryRaw`
      SELECT ${COLUNAS_ESTOQUE} FROM estoque_atual
      WHERE abaixo_do_minimo = true ORDER BY nome LIMIT ${LIMITE_LISTAGEM}`,
    "Erro ao consultar estoque abaixo do mínimo"
  );
}

export async function listarEstoqueAlteradoDesde(desde: Date | null): Promise<EstoqueAtual[]> {
  if (!desde) {
    return listarEstoqueAtual();
  }

  const movimentacoesRecentes = await executar<{ produto_id: string }[]>(
    () =>
      prisma.movimentacaoEstoque.findMany({
        where: { created_at: { gte: desde } },
        select: { produto_id: true },
        take: LIMITE_LISTAGEM,
      }),
    "Erro ao verificar movimentações recentes"
  );

  const idsUnicos = Array.from(new Set(movimentacoesRecentes.map((m) => m.produto_id)));

  if (idsUnicos.length === 0) return [];

  return executar(
    () => prisma.$queryRaw`
      SELECT ${COLUNAS_ESTOQUE} FROM estoque_atual
      WHERE produto_id = ANY(${idsUnicos}::uuid[])`,
    "Erro ao sincronizar estoque"
  );
}
