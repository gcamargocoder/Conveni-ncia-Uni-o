import { hash, verify } from "@node-rs/argon2";
import { SENHA_TAMANHO_MAXIMO } from "./politica-senha";

export * from "./politica-senha";

/**
 * Senhas de usuário. Argon2id (parâmetros mínimos recomendados pela OWASP:
 * 19 MiB, 2 iterações, 1 thread). O hash já carrega salt e parâmetros, então
 * mudar o custo no futuro não invalida senhas antigas.
 */

const OPCOES_ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function gerarHashSenha(senha: string): Promise<string> {
  return hash(senha, OPCOES_ARGON2);
}

export async function verificarSenha(senha: string, hashArmazenado: string): Promise<boolean> {
  try {
    return await verify(hashArmazenado, senha);
  } catch {
    return false;
  }
}

let hashFalso: Promise<string> | null = null;

/**
 * Verifica uma senha contra um hash descartável. Usado quando o e-mail não
 * existe, para que "usuário inexistente" gaste o mesmo tempo de CPU que
 * "senha errada" e o tempo de resposta não revele quais e-mails existem.
 */
export async function gastarTempoDeVerificacao(senha: string): Promise<void> {
  hashFalso ??= gerarHashSenha("senha-descartavel-sem-uso-" + Math.random());
  await verificarSenha(senha, await hashFalso);
}
