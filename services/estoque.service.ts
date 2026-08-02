import { createSupabaseServerClient } from "./supabase/server";
import { unwrap } from "./supabase/query-helpers";
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

export async function registrarMovimentacao(dados: DadosMovimentacao): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase.from("movimentacoes_estoque").insert(dados);

  unwrap(resultado, "Erro ao registrar movimentação");
}

export async function listarEstoqueAtual(): Promise<EstoqueAtual[]> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("estoque_atual")
    .select("produto_id, nome, codigo_barras, categoria_nome, fornecedor_nome, estoque_minimo, quantidade_atual")
    .order("nome")
    .limit(LIMITE_LISTAGEM);

  return unwrap(resultado, "Erro ao consultar estoque");
}

export async function listarProdutosAbaixoDoMinimo(): Promise<EstoqueAtual[]> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("estoque_atual")
    .select("produto_id, nome, codigo_barras, categoria_nome, fornecedor_nome, estoque_minimo, quantidade_atual")
    .eq("abaixo_do_minimo", true)
    .order("nome")
    .limit(LIMITE_LISTAGEM);

  return unwrap(resultado, "Erro ao consultar estoque abaixo do mínimo");
}

export async function listarEstoqueAlteradoDesde(desde: Date | null): Promise<EstoqueAtual[]> {
  if (!desde) {
    return listarEstoqueAtual();
  }

  const supabase = await createSupabaseServerClient();
  const movimentacoesRecentes = await supabase
    .from("movimentacoes_estoque")
    .select("produto_id")
    .gte("created_at", desde.toISOString())
    .limit(LIMITE_LISTAGEM);

  const produtosAlterados = unwrap(movimentacoesRecentes, "Erro ao verificar movimentações recentes");
  const idsUnicos = Array.from(new Set(produtosAlterados.map((m) => m.produto_id)));

  if (idsUnicos.length === 0) return [];

  const resultado = await supabase
    .from("estoque_atual")
    .select("produto_id, nome, codigo_barras, categoria_nome, fornecedor_nome, estoque_minimo, quantidade_atual")
    .in("produto_id", idsUnicos);

  return unwrap(resultado, "Erro ao sincronizar estoque");
}