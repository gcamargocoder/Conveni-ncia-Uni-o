import { createSupabaseServerClient } from "./supabase/server";
import { unwrap } from "./supabase/query-helpers";
import { listarProdutosAbaixoDoMinimo } from "./estoque.service";

export interface ResumoDashboard {
  quantidadeVendasHoje: number;
  faturamentoHoje: number;
  produtosEstoqueBaixo: { produto_id: string; nome: string; quantidade_atual: number }[];
  produtosMaisVendidos: { produto_id: string; nome: string; quantidade_total: number }[];
}

export async function buscarResumoDashboard(): Promise<ResumoDashboard> {
  const supabase = await createSupabaseServerClient();

  const [resumoVendas, produtosEstoqueBaixo, maisVendidos] = await Promise.all([
    supabase.from("resumo_vendas_hoje").select("*").single(),
    listarProdutosAbaixoDoMinimo(),
    supabase.rpc("produtos_mais_vendidos", { p_dias: 30, p_limite: 5 }),
  ]);

  return {
    quantidadeVendasHoje: resumoVendas.data?.quantidade_vendas ?? 0,
    faturamentoHoje: resumoVendas.data?.faturamento ?? 0,
    produtosEstoqueBaixo,
    produtosMaisVendidos: unwrap(maisVendidos, "Erro ao buscar produtos mais vendidos"),
  };
}
