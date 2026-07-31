import { describe, it, expect } from "vitest";
import { validarMovimentacao, exigeObservacao, permissaoNecessaria } from "../movimentacao";

const movimentacaoValida = {
  produto_id: "prod-1",
  tipo: "entrada" as const,
  quantidade: 10,
  funcionario_id: "func-1",
};

describe("validarMovimentacao", () => {
  it("aceita uma movimentação válida", () => {
    expect(validarMovimentacao(movimentacaoValida)).toHaveLength(0);
  });

  it("rejeita quantidade zero ou negativa", () => {
    const erros = validarMovimentacao({ ...movimentacaoValida, quantidade: 0 });
    expect(erros.some((e) => e.campo === "quantidade")).toBe(true);
  });

  it("rejeita movimentação sem produto", () => {
    const erros = validarMovimentacao({ ...movimentacaoValida, produto_id: "" });
    expect(erros.some((e) => e.campo === "produto_id")).toBe(true);
  });

  it("rejeita movimentação sem funcionário responsável", () => {
    const erros = validarMovimentacao({ ...movimentacaoValida, funcionario_id: "" });
    expect(erros.some((e) => e.campo === "funcionario_id")).toBe(true);
  });

  it("rejeita tentativa de lançar tipo 'venda' manualmente", () => {
    const erros = validarMovimentacao({ ...movimentacaoValida, tipo: "venda" });
    expect(erros.some((e) => e.campo === "tipo")).toBe(true);
  });
});

describe("exigeObservacao", () => {
  it("exige observação para perda", () => {
    expect(exigeObservacao("perda")).toBe(true);
  });

  it("exige observação para ajuste de saída", () => {
    expect(exigeObservacao("ajuste_saida")).toBe(true);
  });

  it("não exige observação para entrada normal", () => {
    expect(exigeObservacao("entrada")).toBe(false);
  });
});

describe("permissaoNecessaria", () => {
  it("entrada exige a permissão de entrada", () => {
    expect(permissaoNecessaria("entrada")).toBe("estoque.entrada");
  });

  it("demais tipos manuais exigem a permissão de ajuste", () => {
    expect(permissaoNecessaria("perda")).toBe("estoque.ajuste");
    expect(permissaoNecessaria("ajuste_saida")).toBe("estoque.ajuste");
    expect(permissaoNecessaria("inventario")).toBe("estoque.ajuste");
    expect(permissaoNecessaria("consumo_interno")).toBe("estoque.ajuste");
  });
});
