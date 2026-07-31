import { createSupabaseServerClient } from "./supabase/server";
import { unwrap } from "./supabase/query-helpers";
import { verificarPin, gerarHashPin } from "@/lib/auth/pin";
import { Funcionario } from "@/types/funcionario";

export async function autenticarPorPin(pin: string): Promise<Funcionario | null> {
  const supabase = await createSupabaseServerClient();

  const resultado = await supabase
    .from("funcionarios")
    .select("*")
    .eq("ativo", true)
    .is("deleted_at", null);

  if (resultado.error || !resultado.data) return null;

  for (const funcionario of resultado.data) {
    const confere = await verificarPin(pin, funcionario.pin_hash);
    if (confere) return funcionario as Funcionario;
  }

  return null;
}

export async function criarFuncionario(input: {
  nome: string;
  cargo: Funcionario["cargo"];
  pin: string;
}): Promise<Funcionario> {
  const supabase = await createSupabaseServerClient();
  const pin_hash = await gerarHashPin(input.pin);

  const resultado = await supabase
    .from("funcionarios")
    .insert({ nome: input.nome, cargo: input.cargo, pin_hash })
    .select()
    .single();

  return unwrap(resultado, "Erro ao criar funcionário");
}

export async function listarFuncionarios(): Promise<Funcionario[]> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("funcionarios")
    .select("*")
    .is("deleted_at", null)
    .order("nome")
    .limit(500);

  return unwrap(resultado, "Erro ao listar funcionários");
}

export async function buscarFuncionarioPorId(id: string): Promise<Funcionario | null> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase.from("funcionarios").select("*").eq("id", id).single();
  if (resultado.error || !resultado.data) return null;
  return resultado.data as Funcionario;
}

export async function atualizarFuncionario(
  id: string,
  dados: { nome?: string; cargo?: Funcionario["cargo"]; pin?: string }
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const atualizacoes: Record<string, unknown> = {};
  if (dados.nome !== undefined) atualizacoes.nome = dados.nome;
  if (dados.cargo !== undefined) atualizacoes.cargo = dados.cargo;
  if (dados.pin !== undefined) atualizacoes.pin_hash = await gerarHashPin(dados.pin);

  const resultado = await supabase.from("funcionarios").update(atualizacoes).eq("id", id);
  unwrap(resultado, "Erro ao atualizar funcionário");
}

export async function excluirFuncionario(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("funcionarios")
    .update({ deleted_at: new Date().toISOString(), ativo: false })
    .eq("id", id);
  unwrap(resultado, "Erro ao excluir funcionário");
}