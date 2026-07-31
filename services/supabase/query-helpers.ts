/**
 * Toda consulta ao Supabase segue o mesmo padrão: checar `error`,
 * lançar uma mensagem amigável, ou devolver `data`. Esse padrão
 * estava duplicado em ~19 pontos diferentes dos serviços — qualquer
 * mudança (ex: logging centralizado, telemetria de erro) exigiria
 * editar cada um deles. Centralizado aqui.
 */
export interface ResultadoSupabase<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

export function unwrap<T>(
  resultado: ResultadoSupabase<T>,
  mensagemErro: string,
  mensagensPorCodigo?: Record<string, string>
): T {
  if (resultado.error) {
    const mensagemEspecial = resultado.error.code
      ? mensagensPorCodigo?.[resultado.error.code]
      : undefined;
    throw new Error(mensagemEspecial ?? `${mensagemErro}: ${resultado.error.message}`);
  }
  return resultado.data as T;
}

/**
 * Códigos de erro do Postgres que valem a pena traduzir para o
 * usuário final em qualquer serviço (não só produtos).
 */
export const CODIGOS_POSTGRES = {
  VIOLACAO_UNICIDADE: "23505",
} as const;
