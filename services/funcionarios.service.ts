import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";
import { verificarPin, gerarHashPin } from "@/lib/auth/pin";
import { cargosComPinOffline } from "@/lib/auth/permissoes";
import { Funcionario } from "@/types/funcionario";

export async function autenticarPorPin(pin: string): Promise<Funcionario | null> {
  let candidatos: Funcionario[];
  try {
    candidatos = await executar<Funcionario[]>(
      () => prisma.funcionario.findMany({ where: { ativo: true, deleted_at: null } }),
      "Erro ao autenticar"
    );
  } catch {
    return null;
  }

  for (const funcionario of candidatos) {
    const confere = await verificarPin(pin, funcionario.pin_hash);
    if (confere) return funcionario;
  }

  return null;
}

export async function criarFuncionario(input: {
  nome: string;
  cargo: Funcionario["cargo"];
  pin: string;
}): Promise<Funcionario> {
  const pin_hash = await gerarHashPin(input.pin);

  return executar(
    () => prisma.funcionario.create({ data: { nome: input.nome, cargo: input.cargo, pin_hash } }),
    "Erro ao criar funcionário"
  );
}

/** Funcionário como o navegador pode ver: NUNCA inclui o pin_hash. */
export type FuncionarioCatalogo = Omit<Funcionario, "pin_hash">;

export async function listarFuncionariosCatalogoDesde(desde: Date | null): Promise<FuncionarioCatalogo[]> {
  return executar(
    () =>
      prisma.funcionario.findMany({
        where: desde ? { updated_at: { gte: desde } } : undefined,
        orderBy: { updated_at: "asc" },
        take: 500,
        // select explícito: um campo novo na tabela nunca vaza por acidente.
        select: { id: true, nome: true, cargo: true, ativo: true, created_at: true, updated_at: true, deleted_at: true },
      }),
    "Erro ao sincronizar funcionários"
  );
}

export interface CredencialPinOffline {
  funcionario_id: string;
  pin_hash: string;
}

/**
 * Verificadores de PIN para o uso offline do PDV — SÓ de funcionários ativos cujo cargo apenas
 * vende (cargoPodeUsarPinOffline). Gerente, proprietário e estoquista nunca aparecem aqui.
 */
export async function listarCredenciaisPinOffline(): Promise<CredencialPinOffline[]> {
  const linhas = await executar<{ id: string; pin_hash: string }[]>(
    () =>
      prisma.funcionario.findMany({
        where: { ativo: true, deleted_at: null, cargo: { in: cargosComPinOffline() } },
        select: { id: true, pin_hash: true },
      }),
    "Erro ao preparar PINs offline"
  );
  return linhas.map((l) => ({ funcionario_id: l.id, pin_hash: l.pin_hash }));
}

export async function listarFuncionarios(): Promise<Funcionario[]> {
  return executar(
    () => prisma.funcionario.findMany({ where: { deleted_at: null }, orderBy: { nome: "asc" }, take: 500 }),
    "Erro ao listar funcionários"
  );
}

export async function buscarFuncionarioPorId(id: string): Promise<Funcionario | null> {
  try {
    return await executar<Funcionario | null>(
      () => prisma.funcionario.findUnique({ where: { id } }),
      "Erro ao buscar funcionário"
    );
  } catch {
    return null;
  }
}

export async function atualizarFuncionario(
  id: string,
  dados: { nome?: string; cargo?: Funcionario["cargo"]; pin?: string }
): Promise<void> {
  const atualizacoes: { nome?: string; cargo?: string; pin_hash?: string } = {};
  if (dados.nome !== undefined) atualizacoes.nome = dados.nome;
  if (dados.cargo !== undefined) atualizacoes.cargo = dados.cargo;
  if (dados.pin !== undefined) atualizacoes.pin_hash = await gerarHashPin(dados.pin);

  await executar(() => prisma.funcionario.update({ where: { id }, data: atualizacoes }), "Erro ao atualizar funcionário");
}

export async function excluirFuncionario(id: string): Promise<void> {
  await executar(
    () => prisma.funcionario.update({ where: { id }, data: { deleted_at: new Date(), ativo: false } }),
    "Erro ao excluir funcionário"
  );
}
