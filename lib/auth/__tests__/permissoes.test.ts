import { describe, it, expect } from "vitest";
import { possuiPermissao } from "../permissoes";

describe("possuiPermissao", () => {
  it("caixa pode vender", () => {
    expect(possuiPermissao("caixa", "pdv.vender")).toBe(true);
  });

  it("caixa NÃO pode cancelar venda", () => {
    expect(possuiPermissao("caixa", "pdv.cancelar_venda")).toBe(false);
  });

  it("proprietario pode tudo que testamos", () => {
    expect(possuiPermissao("proprietario", "funcionarios.gerenciar")).toBe(true);
    expect(possuiPermissao("proprietario", "pdv.cancelar_venda")).toBe(true);
  });

  it("estoquista não pode gerenciar funcionários", () => {
    expect(possuiPermissao("estoquista", "funcionarios.gerenciar")).toBe(false);
  });
});
