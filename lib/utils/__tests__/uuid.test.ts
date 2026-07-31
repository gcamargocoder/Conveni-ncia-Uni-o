import { describe, it, expect } from "vitest";
import { gerarUuid } from "../uuid";

const REGEX_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("gerarUuid", () => {
  it("gera um UUID v4 válido usando crypto.randomUUID quando disponível", () => {
    expect(gerarUuid()).toMatch(REGEX_UUID_V4);
  });

  it("nunca gera dois ids iguais em sequência", () => {
    const a = gerarUuid();
    const b = gerarUuid();
    expect(a).not.toBe(b);
  });

  it("usa o fallback via crypto.getRandomValues quando randomUUID não existe (contexto não seguro)", () => {
    const original = crypto.randomUUID;
    // @ts-expect-error simulando ambiente sem randomUUID (HTTP em IP de rede local)
    crypto.randomUUID = undefined;

    try {
      expect(gerarUuid()).toMatch(REGEX_UUID_V4);
    } finally {
      crypto.randomUUID = original;
    }
  });
});