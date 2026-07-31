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

/** Usada pela sincronização do catálogo local — mesma lógica de listarProdutosAlteradosDesde. */
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
