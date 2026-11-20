import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";
import { listarProdutosAbaixoDoMinimo } from "./estoque.service";
import { fimExclusivoDoDiaLocal, hojeLocal, inicioDoDiaLocal } from "@/lib/utils/fuso";

export interface ResumoDashboard {
  quantidadeVendasHoje: number;
  faturamentoHoje: number;
  produtosEstoqueBaixo: { produto_id: string; nome: string; quantidade_atual: number }[];
  produtosMaisVendidos: { produto_id: string; nome: string; quantidade_total: number }[];
}

export async function buscarResumoDashboard(agora: Date = new Date()): Promise<ResumoDashboard> {
  // "Hoje" é o dia da LOJA. A view resumo_vendas_hoje usa date_trunc na zona do banco (UTC) e virava o dia
  // às 21h locais; aqui os limites vêm do calendário America/Sao_Paulo.
  const dia = hojeLocal(agora);
  const inicioDoDia = inicioDoDiaLocal(dia);
  const fimDoDia = fimExclusivoDoDiaLocal(dia);
  const [resumoVendas, produtosEstoqueBaixo, maisVendidos] = await Promise.all([
    executar<{ quantidade_vendas: number; faturamento: number }[]>(
      () => prisma.$queryRaw`
        SELECT count(*)::int AS quantidade_vendas, COALESCE(SUM(total), 0)::float8 AS faturamento
        FROM vendas
        WHERE cancelada = false
          AND COALESCE(ocorrido_em, created_at) >= ${inicioDoDia} AND COALESCE(ocorrido_em, created_at) < ${fimDoDia}`,
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
