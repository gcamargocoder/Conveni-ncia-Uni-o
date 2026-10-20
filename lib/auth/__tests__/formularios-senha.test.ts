import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Se o usuário enviar o formulário antes de a página hidratar, o navegador faz o envio nativo.
 * Sem method="post" isso é um GET e a senha iria parar na URL (histórico, logs, Referer).
 */
const FORMULARIOS = [
  "components/auth/FormLogin.tsx",
  "components/auth/FormRecuperarSenha.tsx",
  "components/auth/FormRedefinirSenha.tsx",
  "components/auth/FormConfigurarConta.tsx",
  "components/auth/FormAtivarConta.tsx",
];

describe("formulários com senha/e-mail", () => {
  it.each(FORMULARIOS)("%s usa method=\"post\"", (arquivo) => {
    const fonte = readFileSync(path.resolve(__dirname, "../../..", arquivo), "utf8");
    expect(fonte).toMatch(/<form[^>]*method="post"/);
  });
});
