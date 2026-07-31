import { createSupabaseServerClient } from "./supabase/server";
import { unwrap } from "./supabase/query-helpers";
import { DadosMovimentacao } from "@/lib/estoque/movimentacao";

export interface EstoqueAtual {
  produto_id: string;
  nome: string;
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
    .from("estoque_atual") // view criada na Etapa 2, corrigida na 0005 e 0013
    .select("produto_id, nome, estoque_minimo, quantidade_atual")
    .order("nome")
    .limit(LIMITE_LISTAGEM);

  return unwrap(resultado, "Erro ao consultar estoque");
}

/**
 * Filtra no banco usando a coluna calculada `abaixo_do_minimo`
 * (migration 0013) — antes, trazia TODO o estoque para o navegador
 * e filtrava em JavaScript, desperdiçando tráfego com um catálogo grande.
 */
export async function listarProdutosAbaixoDoMinimo(): Promise<EstoqueAtual[]> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("estoque_atual")
    .select("produto_id, nome, estoque_minimo, quantidade_atual")
    .eq("abaixo_do_minimo", true)
    .order("nome")
    .limit(LIMITE_LISTAGEM);

  return unwrap(resultado, "Erro ao consultar estoque abaixo do mínimo");
}

/**
 * Usada pela sincronização do catálogo local. Estoque não tem
 * updated_at próprio (é sempre calculado a partir do histórico de
 * movimentações) — então "o que mudou desde X" é descoberto pelas
 * movimentações recentes, não por uma coluna de data no saldo em si.
 * `desde = null` (primeira sincronização) traz o estoque inteiro.
 */
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
    .select("produto_id, nome, estoque_minimo, quantidade_atual")
    .in("produto_id", idsUnicos);

  return unwrap(resultado, "Erro ao sincronizar estoque");
}
