import { createHash, randomBytes } from "node:crypto";

/**
 * Tokens de sessão e de recuperação de senha: 256 bits aleatórios do CSPRNG do
 * sistema. Só o hash SHA-256 vai para o banco — quem ler o banco não consegue
 * reaproveitar um token (e, sendo alta entropia, SHA-256 simples é suficiente;
 * não há o que "quebrar por força bruta").
 */
export function gerarToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Identificador estável (e não reversível) para chaves de limitação por e-mail. */
export function hashIdentificador(valor: string): string {
  return createHash("sha256").update(valor).digest("hex").slice(0, 32);
}
