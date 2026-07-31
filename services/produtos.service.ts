import { createSupabaseServerClient } from "./supabase/server";
import { unwrap, CODIGOS_POSTGRES } from "./supabase/query-helpers";
import { Produto } from "@/types/produto";
import { DadosProduto } from "@/lib/produtos/validacao";

const ERRO_CODIGO_BARRAS_DUPLICADO = "Já existe um produto com esse código de barras.";
const LIMITE_LISTAGEM = 500; // proteção contra carregar um catálogo gigante numa única resposta

export async function listarProdutos(): Promise<Produto[]> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("produtos")
    .select("*")
    .is("deleted_at", null)
    .order("nome")
    .limit(LIMITE_LISTAGEM);

  return unwrap(resultado, "Erro ao listar produtos");
}

/**
 * Usada pela sincronização do catálogo local (Fase 2 do Offline First).
 * Diferente de listarProdutos(): NÃO filtra por ativo/deleted_at — a
 * sincronização precisa saber de produtos desativados/removidos para
 * refletir isso no espelho local, não só dos que continuam válidos.
 * `desde = null` significa primeira sincronização (traz tudo).
 */
export async function listarProdutosAlteradosDesde(desde: Date | null): Promise<Produto[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("produtos").select("*").order("updated_at");

  if (desde) {
    query = query.gte("updated_at", desde.toISOString());
  }

  const resultado = await query.limit(LIMITE_LISTAGEM);
  return unwrap(resultado, "Erro ao sincronizar produtos");
}

export async function buscarProdutoPorCodigoBarras(codigo: string): Promise<Produto | null> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("produtos")
    .select("*")
    .eq("codigo_barras", codigo)
    .is("deleted_at", null)
    .maybeSingle();

  return unwrap(resultado, "Erro ao buscar produto");
}

export async function criarProduto(dados: DadosProduto): Promise<Produto> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase.from("produtos").insert(dados).select().single();

  return unwrap(resultado, "Erro ao criar produto", {
    [CODIGOS_POSTGRES.VIOLACAO_UNICIDADE]: ERRO_CODIGO_BARRAS_DUPLICADO,
  });
}

export async function atualizarProduto(id: string, dados: Partial<DadosProduto>): Promise<Produto> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase.from("produtos").update(dados).eq("id", id).select().single();

  return unwrap(resultado, "Erro ao atualizar produto", {
    [CODIGOS_POSTGRES.VIOLACAO_UNICIDADE]: ERRO_CODIGO_BARRAS_DUPLICADO,
  });
}

// Soft delete: nunca apagamos de verdade (princípio do documento mestre)
export async function desativarProduto(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("produtos")
    .update({ ativo: false, deleted_at: new Date().toISOString() })
    .eq("id", id);

  unwrap(resultado, "Erro ao desativar produto");
}
