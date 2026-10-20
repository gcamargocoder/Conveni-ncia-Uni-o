/**
 * Regras de senha e e-mail SEM dependências de servidor — podem ser importadas
 * por componentes de cliente (validação em tempo real nos formulários).
 */

export const SENHA_TAMANHO_MINIMO = 10;
export const SENHA_TAMANHO_MAXIMO = 128;

const SENHAS_COMUNS = new Set([
  "1234567890",
  "12345678910",
  "0123456789",
  "senha12345",
  "senha123456",
  "password123",
  "qwertyuiop",
  "abcdefghij",
  "123456789a",
  "convenienciauniao",
  "autopostouniao",
]);

export function validarPoliticaSenha(senha: string, email?: string): string[] {
  const erros: string[] = [];

  if (typeof senha !== "string" || senha.length < SENHA_TAMANHO_MINIMO) {
    erros.push(`A senha deve ter pelo menos ${SENHA_TAMANHO_MINIMO} caracteres.`);
    return erros;
  }
  if (senha.length > SENHA_TAMANHO_MAXIMO) {
    erros.push(`A senha deve ter no máximo ${SENHA_TAMANHO_MAXIMO} caracteres.`);
    return erros;
  }
  if (!/[A-Za-zÀ-ÿ]/.test(senha) || !/\d/.test(senha)) {
    erros.push("A senha deve conter letras e números.");
  }
  if (new Set(senha).size < 4) {
    erros.push("A senha é muito repetitiva.");
  }
  if (SENHAS_COMUNS.has(senha.toLowerCase())) {
    erros.push("Essa senha é muito comum. Escolha outra.");
  }
  const usuarioEmail = email?.split("@")[0]?.toLowerCase();
  if (usuarioEmail && usuarioEmail.length >= 4 && senha.toLowerCase().includes(usuarioEmail)) {
    erros.push("A senha não pode conter o seu e-mail.");
  }

  return erros;
}

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailValido(email: string): boolean {
  return email.length <= 254 && REGEX_EMAIL.test(email);
}
