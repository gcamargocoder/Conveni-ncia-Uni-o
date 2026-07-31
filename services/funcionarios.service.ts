import { createSupabaseServerClient } from "./supabase/server";
import { unwrap } from "./supabase/query-helpers";
import { verificarPin, gerarHashPin } from "@/lib/auth/pin";
import { Funcionario } from "@/types/funcionario";

/**
 * Nenhum outro arquivo consulta a tabela `funcionarios` diretamente.
 * Tudo passa por aqui — assim, quando entrarmos em Offline First,
 * só este arquivo precisa mudar.
 */

export async function autenticarPorPin(pin: string): Promise<Funcionario | null> {
  const supabase = await createSupabaseServerClient();

  // Busca só funcionários ativos — não vazamos existência de inativos.
  const resultado = await supabase
    .from("funcionarios")
    .select("*")
    .eq("ativo", true)
    .is("deleted_at", null);

  if (resultado.error || !resultado.data) return null;

  // O PIN não pode ser buscado direto no WHERE (está em hash), então
  // comparamos um a um. Com poucas dezenas de funcionários por posto,
  // isso é rápido o suficiente e evita expor timing de índice por PIN.
  // NOTA DE AUDITORIA: isso escala por número de FUNCIONÁRIOS (dezenas),
  // não por clientes do SaaS — cada posto só compara contra seus
  // próprios funcionários. Se um único posto chegasse a centenas de
  // funcionários simultâneos, valeria reconsiderar.
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
