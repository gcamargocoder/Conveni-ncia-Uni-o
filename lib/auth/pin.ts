import bcrypt from "bcryptjs";

/**
 * Regras do PIN do operador. Isolado aqui (fora de services/ e de app/)
 * porque é lógica pura — não depende de banco nem de UI, então é fácil
 * de testar sozinho.
 */

const PIN_LENGTH = 4;
const SALT_ROUNDS = 10;

export function validarFormatoPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

export async function gerarHashPin(pin: string): Promise<string> {
  if (!validarFormatoPin(pin)) {
    throw new Error(`PIN deve conter exatamente ${PIN_LENGTH} dígitos numéricos.`);
  }
  return bcrypt.hash(pin, SALT_ROUNDS);
}

export async function verificarPin(pin: string, hash: string): Promise<boolean> {
  if (!validarFormatoPin(pin)) return false;
  return bcrypt.compare(pin, hash);
}
