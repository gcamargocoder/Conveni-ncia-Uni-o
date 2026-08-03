import { createSupabaseServerClient } from "./supabase/server";
import { unwrap } from "./supabase/query-helpers";

export interface Categoria {
  id: string;
  nome: string;
  ativo: boolean;
  updated_at?: string;
}

export async function listarCategorias(): Promise<Categoria[]> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("categorias")
    .select("id, nome, ativo")
    .is("deleted_at", null)
    .order("nome")
    .limit(500);

  return unwrap(resultado, "Erro ao listar categorias");
}

export async function listarCategoriasAlteradasDesde(desde: Date | null): Promise<Categoria[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("categorias").select("id, nome, ativo, updated_at").order("updated_at");

  if (desde) {
    query = query.gte("updated_at", desde.toISOString());
  }

  const resultado = await query.limit(500);
  return unwrap(resultado, "Erro ao sincronizar categorias");
}

export async function criarCategoria(nome: string): Promise<Categoria> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("categorias")
    .insert({ nome })
    .select("id, nome, ativo")
    .single();

  return unwrap(resultado, "Erro ao criar categoria");
}

export async function atualizarCategoria(id: string, nome: string): Promise<Categoria> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("categorias")
    .update({ nome })
    .eq("id", id)
    .select("id, nome, ativo")
    .single();

  return unwrap(resultado, "Erro ao atualizar categoria");
}

export async function excluirCategoria(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const produtosVinculados = await supabase.from("produtos").select("id").eq("categoria_id", id).limit(1);
  const temProdutos = unwrap(produtosVinculados, "Erro ao verificar produtos da categoria");

  if (temProdutos.length > 0) {
    throw new Error(
      "Esta categoria tem produtos cadastrados nela e não pode ser excluída — mude a categoria desses produtos primeiro, ou edite o nome em vez de excluir."
    );
  }

  const resultado = await supabase.from("categorias").delete().eq("id", id);
  unwrap(resultado, "Erro ao excluir categoria");
}