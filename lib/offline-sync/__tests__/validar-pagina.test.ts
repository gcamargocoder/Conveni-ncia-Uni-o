import { describe, expect, it } from "vitest";
import { validarEntradaPagina } from "../validar-pagina";

const ID = "3f2b8c1e-9d4a-4e6b-8a7c-1d2e3f4a5b6c";
const ok = { entidade: "produtos", desde: null, ate: null, apos: null };

describe("validarEntradaPagina (a entrada vem do navegador)", () => {
  it("aceita a primeira página e uma página intermediária com microssegundos", () => {
    expect(validarEntradaPagina(ok).entidade).toBe("produtos");
    const v = validarEntradaPagina({
      entidade: "clientes",
      desde: "2026-11-20T10:00:00.000Z",
      ate: "2026-11-20T12:00:00.123456Z",
      apos: { t: "2026-11-20T11:00:00.654321Z", id: ID },
      tamanho: 500,
    });
    expect(v.apos).toEqual({ t: "2026-11-20T11:00:00.654321Z", id: ID });
  });

  it("estoque aceita cursor só com id; as demais entidades exigem a data", () => {
    expect(validarEntradaPagina({ ...ok, entidade: "estoque", apos: { t: null, id: ID } }).apos).toEqual({ t: null, id: ID });
    expect(() => validarEntradaPagina({ ...ok, apos: { t: null, id: ID } })).toThrow(/apos/);
  });

  it.each([
    ["entidade fora da lista", { ...ok, entidade: "usuarios" }],
    ["entidade com SQL", { ...ok, entidade: "produtos; DROP TABLE produtos" }],
    ["data que não é ISO UTC", { ...ok, desde: "ontem" }],
    ["data com injeção", { ...ok, ate: "2026-11-20T10:00:00Z'; DROP TABLE x;--" }],
    ["id que não é UUID", { ...ok, apos: { t: "2026-11-20T11:00:00.000Z", id: "1 OR 1=1" } }],
    ["janela invertida", { ...ok, desde: "2026-11-21T00:00:00.000Z", ate: "2026-11-20T00:00:00.000Z" }],
    ["tamanho zero", { ...ok, tamanho: 0 }],
    ["tamanho acima do máximo (resposta gigante)", { ...ok, tamanho: 100000 }],
    ["tamanho fracionário", { ...ok, tamanho: 10.5 }],
    ["entrada nula", null],
  ])("recusa %s", (_nome, entrada) => {
    expect(() => validarEntradaPagina(entrada)).toThrow();
  });
});
