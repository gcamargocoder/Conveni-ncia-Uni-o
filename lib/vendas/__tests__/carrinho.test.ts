import { describe, it, expect } from "vitest";
import { adicionarItem, removerItem, alterarQuantidade, calcularTotal, ItemCarrinho } from "../carrinho";

const produto = { produto_id: "p1", nome: "Refrigerante", preco_unitario: 5 };

describe("adicionarItem", () => {
  it("adiciona um item novo ao carrinho vazio", () => {
    const carrinho = adicionarItem([], produto);
    expect(carrinho).toHaveLength(1);
    expect(carrinho[0].quantidade).toBe(1);
  });

  it("soma quantidade se o produto já está no carrinho", () => {
    const carrinho = adicionarItem([{ ...produto, quantidade: 2 }], produto, 3);
    expect(carrinho).toHaveLength(1);
    expect(carrinho[0].quantidade).toBe(5);
  });
});

describe("removerItem", () => {
  it("remove o item correto", () => {
    const carrinho: ItemCarrinho[] = [
      { ...produto, quantidade: 1 },
      { produto_id: "p2", nome: "Água", preco_unitario: 3, quantidade: 1 },
    ];
    const resultado = removerItem(carrinho, "p1");
    expect(resultado).toHaveLength(1);
    expect(resultado[0].produto_id).toBe("p2");
  });
});

describe("alterarQuantidade", () => {
  it("altera a quantidade de um item", () => {
    const carrinho = alterarQuantidade([{ ...produto, quantidade: 1 }], "p1", 4);
    expect(carrinho[0].quantidade).toBe(4);
  });

  it("remove o item se a quantidade cair para zero ou menos", () => {
    const carrinho = alterarQuantidade([{ ...produto, quantidade: 1 }], "p1", 0);
    expect(carrinho).toHaveLength(0);
  });
});

describe("calcularTotal", () => {
  it("soma corretamente múltiplos itens", () => {
    const carrinho: ItemCarrinho[] = [
      { ...produto, quantidade: 2 }, // 10
      { produto_id: "p2", nome: "Água", preco_unitario: 3, quantidade: 3 }, // 9
    ];
    expect(calcularTotal(carrinho)).toBe(19);
  });

  it("retorna zero para carrinho vazio", () => {
    expect(calcularTotal([])).toBe(0);
  });
});
