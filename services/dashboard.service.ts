import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";
import { listarProdutosAbaixoDoMinimo } from "./estoque.service";

export interface ResumoDashboard {
  quantidadeVendasHoje: number;
  faturamentoHoje: number;
  produtosEstoqueBaixo: { produto_id: string; nome: string; quantidade_atual: number }[];
  produtosMaisVendidos: { produto_id: string; nome: string; quantidade_total: number }[];
}

export async function buscarResumoDashboard(): Promise<ResumoDashboard> {
  const [resumoVendas, produtosEstoqueBaixo, maisVendidos] = await Promise.all([
    executar<{ quantidade_vendas: number; faturamento: number }[]>(
      () => prisma.$queryRaw`
        SELECT quantidade_vendas::int AS quantidade_vendas, faturamento FROM resumo_vendas_hoje`,
      "Erro ao buscar resumo de vendas"
    ),
    listarProdutosAbaixoDoMinimo(),
    executar<ResumoDashboard["produtosMaisVendidos"]>(
      () => prisma.$queryRaw`SELECT * FROM produtos_mais_vendidos(30, 5)`,
      "Erro ao buscar produtos mais vendidos"
    ),
  ]);

  return {
    quantidadeVendasHoje: resumoVendas[0]?.quantidade_vendas ?? 0,
    faturamentoHoje: resumoVendas[0]?.faturamento ?? 0,
    produtosEstoqueBaixo,
    produtosMaisVendidos: maisVendidos,
  };
}
