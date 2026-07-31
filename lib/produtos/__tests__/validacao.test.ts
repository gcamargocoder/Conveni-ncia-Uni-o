import { describe, it, expect } from "vitest";
import { validarProduto, precoVendaAbaixoDoCusto, calcularMargemPercentual } from "../validacao";

const produtoValido = {
  nome: "Refrigerante Lata 350ml",
  categoria_id: "abc-123",
  preco_venda: 5,
  preco_custo: 3,
  estoque_minimo: 10,
  codigo_barras: "7891234567890",
};

describe("validarProduto", () => {
  it("aceita um produto válido", () => {
    expect(validarProduto(produtoValido)).toHaveLength(0);
  });

  it("rejeita nome muito curto", () => {
    const erros = validarProduto({ ...produtoValido, nome: "A" });
    expect(erros.some((e) => e.campo === "nome")).toBe(true);
  });

  it("rejeita preço de venda zero ou negativo", () => {
    const erros = validarProduto({ ...produtoValido, preco_venda: 0 });
    expect(erros.some((e) => e.campo === "preco_venda")).toBe(true);
  });

  it("rejeita categoria vazia", () => {
    const erros = validarProduto({ ...produtoValido, categoria_id: "" });
    expect(erros.some((e) => e.campo === "categoria_id")).toBe(true);
  });

  it("rejeita código de barras muito curto quando preenchido", () => {
    const erros = validarProduto({ ...produtoValido, codigo_barras: "123" });
    expect(erros.some((e) => e.campo === "codigo_barras")).toBe(true);
  });

  it("aceita código de barras vazio (é opcional)", () => {
    const erros = validarProduto({ ...produtoValido, codigo_barras: "" });
    expect(erros.some((e) => e.campo === "codigo_barras")).toBe(false);
  });
});

describe("precoVendaAbaixoDoCusto", () => {
  it("detecta quando o preço de venda é menor que o custo", () => {
    expect(precoVendaAbaixoDoCusto({ ...produtoValido, preco_venda: 2, preco_custo: 3 })).toBe(true);
  });

  it("não alerta quando a venda é maior que o custo", () => {
    expect(precoVendaAbaixoDoCusto(produtoValido)).toBe(false);
  });
});

describe("calcularMargemPercentual", () => {
  it("calcula a margem corretamente", () => {
    expect(calcularMargemPercentual(5, 4)).toBeCloseTo(25);
  });

  it("não quebra com custo zero", () => {
    expect(calcularMargemPercentual(5, 0)).toBe(0);
  });
});
