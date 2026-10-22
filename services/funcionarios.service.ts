import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";
import { verificarPin, gerarHashPin } from "@/lib/auth/pin";
import { cargosComPinOffline } from "@/lib/auth/permissoes";
import { Funcionario, FuncionarioPublico } from "@/types/funcionario";

/** Campos que podem sair do servidor. O pin_hash fica de fora de propósito (select explícito). */
const SELECT_PUBLICO = {
  id: true,
  nome: true,
  cargo: true,
  ativo: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
} as const;

function paraPublico(f: FuncionarioPublico): FuncionarioPublico {
  return {
    id: f.id,
    nome: f.nome,
    cargo: f.cargo,
    ativo: f.ativo,
    created_at: f.created_at,
    updated_at: f.updated_at,
    deleted_at: f.deleted_at,
  };
}

export async function autenticarPorPin(pin: string): Promise<FuncionarioPublico | null> {
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
    if (confere) return paraPublico(funcionario);
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

export async function listarFuncionarios(): Promise<FuncionarioPublico[]> {
  const linhas = await executar<FuncionarioPublico[]>(
    () =>
      prisma.funcionario.findMany({
        where: { deleted_at: null },
        orderBy: { nome: "asc" },
        take: 500,
        select: SELECT_PUBLICO,
      }),
    "Erro ao listar funcionários"
  );
  return linhas.map(paraPublico);
}

export async function buscarFuncionarioPorId(id: string): Promise<FuncionarioPublico | null> {
  try {
    const f = await executar<FuncionarioPublico | null>(
      () => prisma.funcionario.findUnique({ where: { id }, select: SELECT_PUBLICO }),
      "Erro ao buscar funcionário"
    );
    return f ? paraPublico(f) : null;
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


/** Quantos proprietários ativos existem — zero significa que a configuração inicial ainda não foi feita. */
export async function contarProprietariosAtivos(): Promise<number> {
  return executar<number>(
    () => prisma.funcionario.count({ where: { cargo: "proprietario", ativo: true, deleted_at: null } }),
    "Erro ao verificar o proprietário"
  );
}

/**
 * O PIN identifica o funcionário nas vendas e movimentações; dois funcionários com o mesmo PIN
 * tornariam a identificação ambígua. Confere contra todos os ativos, exceto `ignorarId`.
 */
export async function pinEmUsoPorOutro(pin: string, ignorarId?: string): Promise<boolean> {
  const candidatos = await executar<Funcionario[]>(
    () => prisma.funcionario.findMany({ where: { ativo: true, deleted_at: null } }),
    "Erro ao verificar o PIN"
  );
  for (const f of candidatos) {
    if (f.id === ignorarId) continue;
    if (await verificarPin(pin, f.pin_hash)) return true;
  }
  return false;
}

export class ProprietarioJaConfiguradoError extends Error {
  constructor() {
    super("O proprietário já foi configurado.");
    this.name = "ProprietarioJaConfiguradoError";
  }
}

/**
 * Cria o primeiro proprietário. A checagem "não existe nenhum" e a criação rodam sob um
 * advisory lock transacional, para duas requisições simultâneas não criarem dois.
 */
export async function criarProprietarioInicial(input: { nome: string; pin: string }): Promise<{ id: string }> {
  const pin_hash = await gerarHashPin(input.pin);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('funcionarios_proprietario_inicial'))`;
    const existentes = await tx.funcionario.count({
      where: { cargo: "proprietario", ativo: true, deleted_at: null },
    });
    if (existentes > 0) throw new ProprietarioJaConfiguradoError();
    return tx.funcionario.create({ data: { nome: input.nome, cargo: "proprietario", pin_hash }, select: { id: true } });
  });
}
