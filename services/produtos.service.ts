import { prisma } from "./prisma/client";
import { executar, CODIGOS_PRISMA } from "./prisma/query-helpers";
import { Produto } from "@/types/produto";
import { DadosProduto } from "@/lib/produtos/validacao";

const ERRO_CODIGO_BARRAS_DUPLICADO = "Já existe um produto com esse código de barras.";
const LIMITE_LISTAGEM = 500; // proteção contra carregar um catálogo gigante numa única resposta

export async function listarProdutos(): Promise<Produto[]> {
  return executar(
    () =>
      prisma.produto.findMany({
        where: { deleted_at: null },
        orderBy: { nome: "asc" },
        take: LIMITE_LISTAGEM,
      }),
    "Erro ao listar produtos"
  );
}

/**
 * Usada pela sincronização do catálogo local (Fase 2 do Offline First).
 * Diferente de listarProdutos(): NÃO filtra por ativo/deleted_at — a
 * sincronização precisa saber de produtos desativados/removidos para
 * refletir isso no espelho local, não só dos que continuam válidos.
 * `desde = null` significa primeira sincronização (traz tudo).
 */
export async function listarProdutosAlteradosDesde(desde: Date | null): Promise<Produto[]> {
  return executar(
    () =>
      prisma.produto.findMany({
        where: desde ? { updated_at: { gte: desde } } : undefined,
        orderBy: { updated_at: "asc" },
        take: LIMITE_LISTAGEM,
      }),
    "Erro ao sincronizar produtos"
  );
}

export async function buscarProdutoPorCodigoBarras(codigo: string): Promise<Produto | null> {
  return executar(
    () => prisma.produto.findFirst({ where: { codigo_barras: codigo, deleted_at: null } }),
    "Erro ao buscar produto"
  );
}

export async function criarProduto(dados: DadosProduto): Promise<Produto> {
  return executar(() => prisma.produto.create({ data: dados }), "Erro ao criar produto", {
    [CODIGOS_PRISMA.VIOLACAO_UNICIDADE]: ERRO_CODIGO_BARRAS_DUPLICADO,
  });
}

export async function atualizarProduto(id: string, dados: Partial<DadosProduto>): Promise<Produto> {
  return executar(() => prisma.produto.update({ where: { id }, data: dados }), "Erro ao atualizar produto", {
    [CODIGOS_PRISMA.VIOLACAO_UNICIDADE]: ERRO_CODIGO_BARRAS_DUPLICADO,
  });
}

// Soft delete: nunca apagamos de verdade (princípio do documento mestre)
export async function desativarProduto(id: string): Promise<void> {
  await executar(
    () => prisma.produto.update({ where: { id }, data: { ativo: false, deleted_at: new Date() } }),
    "Erro ao desativar produto"
  );
}
