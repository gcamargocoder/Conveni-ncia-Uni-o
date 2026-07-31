import { describe, it, expect } from "vitest";
import { validarFormatoPin, gerarHashPin, verificarPin } from "../pin";

describe("validarFormatoPin", () => {
  it("aceita PIN de 4 dígitos", () => {
    expect(validarFormatoPin("1234")).toBe(true);
  });

  it("rejeita PIN com letras", () => {
    expect(validarFormatoPin("12a4")).toBe(false);
  });

  it("rejeita PIN com menos de 4 dígitos", () => {
    expect(validarFormatoPin("123")).toBe(false);
  });

  it("rejeita PIN com mais de 4 dígitos", () => {
    expect(validarFormatoPin("12345")).toBe(false);
  });
});

describe("gerarHashPin / verificarPin", () => {
  it("gera um hash diferente do PIN original", async () => {
    const hash = await gerarHashPin("1234");
    expect(hash).not.toBe("1234");
  });

  it("verifica corretamente um PIN válido", async () => {
    const hash = await gerarHashPin("1234");
    expect(await verificarPin("1234", hash)).toBe(true);
  });

  it("rejeita um PIN incorreto", async () => {
    const hash = await gerarHashPin("1234");
    expect(await verificarPin("9999", hash)).toBe(false);
  });

  it("rejeita gerar hash de PIN em formato inválido", async () => {
    await expect(gerarHashPin("12a4")).rejects.toThrow();
  });
});
