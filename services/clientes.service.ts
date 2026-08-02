import { createSupabaseServerClient } from "./supabase/server";
import { unwrap } from "./supabase/query-helpers";
import { DadosCliente } from "@/lib/clientes/validacao";
import { Cliente } from "@/types/cliente";

const LIMITE_LISTAGEM = 500;

export async function listarClientesAlteradosDesde(desde: Date | null): Promise<Cliente[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("clientes").select("*").order("updated_at");

  if (desde) {
    query = query.gte("updated_at", desde.toISOString());
  }

  const resultado = await query.limit(LIMITE_LISTAGEM);
  return unwrap(resultado, "Erro ao sincronizar clientes");
}

export async function listarClientes(): Promise<Cliente[]> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("clientes")
    .select("*")
    .is("deleted_at", null)
    .order("nome")
    .limit(LIMITE_LISTAGEM);

  return unwrap(resultado, "Erro ao listar clientes");
}

export async function buscarCliente(id: string): Promise<Cliente | null> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase.from("clientes").select("*").eq("id", id).single();
  if (resultado.error || !resultado.data) return null;
  return resultado.data as Cliente;
}

export async function criarCliente(dados: DadosCliente): Promise<Cliente> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase.from("clientes").insert(dados).select().single();
  return unwrap(resultado, "Erro ao criar cliente");
}

export async function atualizarCliente(id: string, dados: DadosCliente): Promise<Cliente> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase.from("clientes").update(dados).eq("id", id).select().single();
  return unwrap(resultado, "Erro ao atualizar cliente");
}

export async function desativarCliente(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("clientes")
    .update({ deleted_at: new Date().toISOString(), ativo: false })
    .eq("id", id);

  unwrap(resultado, "Erro ao desativar cliente");
}