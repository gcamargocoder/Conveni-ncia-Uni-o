import { Prisma } from "@prisma/client";

/**
 * Toda consulta ao banco segue o mesmo padrão: executar, lançar uma
 * mensagem amigável se falhar, ou devolver os dados já serializados.
 * Centralizado aqui (antes vivia em services/supabase/query-helpers.ts).
 */

/**
 * O Prisma devolve `Decimal` para colunas numeric e `Date` para timestamptz.
 * A aplicação (e as Server Actions, que só trafegam dados serializáveis)
 * espera `number` e string ISO — igual ao que o PostgREST devolvia.
 */
export function serializar<T>(valor: unknown): T {
  if (valor === null || valor === undefined) return valor as T;
  if (Prisma.Decimal.isDecimal(valor)) return (valor as Prisma.Decimal).toNumber() as T;
  if (valor instanceof Date) return valor.toISOString() as T;
  if (typeof valor === "bigint") return Number(valor) as T;
  if (Array.isArray(valor)) return valor.map((v) => serializar(v)) as T;
  if (typeof valor === "object") {
    const resultado: Record<string, unknown> = {};
    for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
      resultado[chave] = serializar(v);
    }
    return resultado as T;
  }
  return valor as T;
}

/**
 * Códigos de erro do Prisma que valem a pena traduzir para o
 * usuário final em qualquer serviço.
 */
export const CODIGOS_PRISMA = {
  VIOLACAO_UNICIDADE: "P2002",
} as const;

export async function executar<T>(
  operacao: () => Promise<unknown>,
  mensagemErro: string,
  mensagensPorCodigo?: Record<string, string>
): Promise<T> {
  try {
    return serializar<T>(await operacao());
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      const mensagemEspecial = mensagensPorCodigo?.[e.code];
      throw new Error(mensagemEspecial ?? `${mensagemErro}: ${e.message}`);
    }
    if (e instanceof Error) {
      throw new Error(`${mensagemErro}: ${e.message}`);
    }
    throw e;
  }
}
