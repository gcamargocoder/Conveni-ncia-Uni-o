import { createSupabaseServerClient } from "./supabase/server";
import { unwrap } from "./supabase/query-helpers";
import { DadosFornecedor } from "@/lib/fornecedores/validacao";

export interface Fornecedor {
  id: string;
  nome: string;
  razao_social: string | null;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  cnpj_cpf: string | null;
  endereco: string | null;
  cidade: string | null;
  estado: string | null;
  observacoes: string | null;
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

export async function buscarFornecedorPorId(id: string): Promise<Fornecedor | null> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase.from("fornecedores").select("*").eq("id", id).single();
  if (resultado.error || !resultado.data) return null;
  return resultado.data as Fornecedor;
}

export async function criarFornecedor(dados: DadosFornecedor): Promise<Fornecedor> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase.from("fornecedores").insert(dados).select().single();
  return unwrap(resultado, "Erro ao criar fornecedor");
}

export async function atualizarFornecedor(id: string, dados: DadosFornecedor): Promise<Fornecedor> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase.from("fornecedores").update(dados).eq("id", id).select().single();
  return unwrap(resultado, "Erro ao atualizar fornecedor");
}