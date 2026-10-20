import { describe, it, expect } from "vitest";
import {
  emailValido,
  gastarTempoDeVerificacao,
  gerarHashSenha,
  normalizarEmail,
  validarPoliticaSenha,
  verificarSenha,
} from "../senha";

describe("política de senha", () => {
  it("aceita senha forte", () => {
    expect(validarPoliticaSenha("Cafe-com-Leite-42")).toEqual([]);
  });

  it("rejeita senha curta", () => {
    expect(validarPoliticaSenha("abc123")[0]).toMatch(/pelo menos 10/);
  });

  it("rejeita senha longa demais (evita abuso de CPU no hash)", () => {
    expect(validarPoliticaSenha("a1".repeat(100))[0]).toMatch(/no máximo 128/);
  });

  it("exige letras e números", () => {
    expect(validarPoliticaSenha("somenteletrasaqui")).toContain("A senha deve conter letras e números.");
    expect(validarPoliticaSenha("12345678901234")).toContain("A senha deve conter letras e números.");
  });

  it("rejeita senhas comuns e repetitivas", () => {
    expect(validarPoliticaSenha("senha12345").join(" ")).toMatch(/comum/);
    expect(validarPoliticaSenha("aaaaaaaaa1").join(" ")).toMatch(/repetitiva/);
  });

  it("rejeita senha que contém o e-mail", () => {
    expect(validarPoliticaSenha("maria.silva2024x", "maria.silva@loja.com").join(" ")).toMatch(/e-mail/);
  });
});

describe("hash de senha (Argon2id)", () => {
  it("gera Argon2id com salt (hashes diferentes para a mesma senha) e nunca a senha em texto", async () => {
    const h1 = await gerarHashSenha("Cafe-com-Leite-42");
    const h2 = await gerarHashSenha("Cafe-com-Leite-42");
    expect(h1).toMatch(/^\$argon2id\$/);
    expect(h1).not.toContain("Cafe-com-Leite-42");
    expect(h1).not.toBe(h2);
  });

  it("verifica a senha correta e rejeita a errada", async () => {
    const h = await gerarHashSenha("Cafe-com-Leite-42");
    expect(await verificarSenha("Cafe-com-Leite-42", h)).toBe(true);
    expect(await verificarSenha("Cafe-com-Leite-43", h)).toBe(false);
  });

  it("hash inválido/corrompido é rejeitado sem lançar", async () => {
    expect(await verificarSenha("qualquer", "isto-nao-e-um-hash")).toBe(false);
  });

  it("verificação descartável (usuário inexistente) não lança", async () => {
    await expect(gastarTempoDeVerificacao("qualquer-coisa")).resolves.toBeUndefined();
  });
});

describe("e-mail", () => {
  it("normaliza e valida", () => {
    expect(normalizarEmail("  Maria@Loja.COM ")).toBe("maria@loja.com");
    expect(emailValido("maria@loja.com")).toBe(true);
    expect(emailValido("maria@loja")).toBe(false);
    expect(emailValido("maria loja@x.com")).toBe(false);
    expect(emailValido("a".repeat(250) + "@x.com")).toBe(false);
  });
});
