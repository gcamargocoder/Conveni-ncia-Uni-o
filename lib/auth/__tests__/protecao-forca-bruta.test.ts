import { describe, it, expect } from "vitest";
import { estaBloqueado, deveBloquear, MAX_TENTATIVAS } from "../protecao-forca-bruta";

describe("estaBloqueado", () => {
  it("não bloqueia quando bloqueado_ate é nulo", () => {
    expect(estaBloqueado({ tentativas_falhas: 3, bloqueado_ate: null })).toBe(false);
  });

  it("bloqueia quando bloqueado_ate está no futuro", () => {
    const futuro = new Date(Date.now() + 60_000).toISOString();
    expect(estaBloqueado({ tentativas_falhas: 5, bloqueado_ate: futuro })).toBe(true);
  });

  it("não bloqueia quando bloqueado_ate já passou", () => {
    const passado = new Date(Date.now() - 60_000).toISOString();
    expect(estaBloqueado({ tentativas_falhas: 5, bloqueado_ate: passado })).toBe(false);
  });

  it("não bloqueia quando não há estado nenhum (primeira tentativa)", () => {
    expect(estaBloqueado(null)).toBe(false);
  });
});

describe("deveBloquear", () => {
  it("bloqueia ao atingir o limite de tentativas", () => {
    expect(deveBloquear(MAX_TENTATIVAS - 1)).toBe(true);
  });

  it("não bloqueia antes do limite", () => {
    expect(deveBloquear(0)).toBe(false);
  });
});
