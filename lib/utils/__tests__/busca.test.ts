import { describe, expect, it } from "vitest";
import { correspondeBusca, normalizarBusca } from "../busca";

describe("normalizarBusca", () => {
  it("remove acentos, ignora maiúsculas e comprime espaços", () => {
    expect(normalizarBusca("  ÁGUA   Mineral ")).toBe("agua mineral");
    expect(normalizarBusca("Pão de Açúcar")).toBe("pao de acucar");
    expect(normalizarBusca("CAFÉ")).toBe("cafe");
  });
});

describe("correspondeBusca", () => {
  it("sem acento encontra com acento e vice-versa", () => {
    expect(correspondeBusca("Água 500ml", "agua")).toBe(true);
    expect(correspondeBusca("Agua 500ml", "ÁGUA")).toBe(true);
    expect(correspondeBusca("Refrigerante Guaraná", "guarana")).toBe(true);
  });
  it("maiúsculas/minúsculas não importam", () => {
    expect(correspondeBusca("coca-cola 2L", "COCA")).toBe(true);
  });
  it("busca vazia ou só espaços mostra tudo", () => {
    expect(correspondeBusca("Qualquer", "")).toBe(true);
    expect(correspondeBusca("Qualquer", "   ")).toBe(true);
  });
  it("trecho no meio do nome casa; o que não existe não casa", () => {
    expect(correspondeBusca("Suco de Laranja", "laran")).toBe(true);
    expect(correspondeBusca("Suco de Laranja", "uva")).toBe(false);
  });
  it("caracteres especiais de regex são tratados como texto", () => {
    expect(correspondeBusca("Pilha (AA)", "(aa)")).toBe(true);
    expect(correspondeBusca("Pilha AA", ".*")).toBe(false);
  });
});
