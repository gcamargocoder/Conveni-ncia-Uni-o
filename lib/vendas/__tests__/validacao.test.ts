import { describe, it, expect } from "vitest";
import { validarVenda } from "../validacao";

const item = { produto_id: "p1", nome: "Refrigerante", preco_unitario: 5, quantidade: 1 };

describe("validarVenda", () => {
  it("aceita venda com item e forma de pagamento válidos", () => {
    expect(validarVenda([item], "pix")).toHaveLength(0);
  });

  it("rejeita carrinho vazio", () => {
    const erros = validarVenda([], "pix");
    expect(erros.some((e) => e.campo === "itens")).toBe(true);
  });

  it("rejeita forma de pagamento inválida", () => {
    const erros = validarVenda([item], "boleto" as any);
    expect(erros.some((e) => e.campo === "forma_pagamento")).toBe(true);
  });

  it("NUNCA valida estoque disponível — a venda não pode ser bloqueada por isso", () => {
    // Não existe um campo de erro "estoque" possível — este teste documenta a garantia.
    const camposPossiveis = validarVenda([item], "pix").map((e) => e.campo);
    expect(camposPossiveis).not.toContain("estoque");
  });
});
