import { createSupabaseServerClient } from "./supabase/server";
import { unwrap } from "./supabase/query-helpers";

export interface Fornecedor {
  id: string;
  nome: string;
  telefone: string | null;
  cnpj_cpf: string | null;
  ativo: boolean;
}

export async function listarFornecedores(): Promise<Fornecedor[]> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("fornecedores")
    .select("*")
    .is("deleted_at", null)
    .order("nome")
    .limit(500);

  return unwrap(resultado, "Erro ao listar fornecedores");
}

export async function criarFornecedor(input: {
  nome: string;
  telefone?: string;
  cnpj_cpf?: string;
}): Promise<Fornecedor> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase.from("fornecedores").insert(input).select().single();

  return unwrap(resultado, "Erro ao criar fornecedor");
}
