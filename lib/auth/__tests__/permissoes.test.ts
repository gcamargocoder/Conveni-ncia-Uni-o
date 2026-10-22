import { describe, it, expect } from "vitest";
import { possuiPermissao, podeGerenciarFuncionario, cargoPodeUsarPinOffline } from "../permissoes";

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

describe("proprietário e gerente têm as mesmas permissões administrativas", () => {
  const todas = [
    "pdv.vender",
    "pdv.cancelar_venda",
    "estoque.entrada",
    "estoque.ajuste",
    "produtos.editar",
    "funcionarios.gerenciar",
    "clientes.gerenciar",
    "contas_receber.registrar_pagamento",
    "relatorios.visualizar",
  ] as const;

  it("equivalência total", () => {
    for (const p of todas) {
      expect(possuiPermissao("gerente", p)).toBe(possuiPermissao("proprietario", p));
      expect(possuiPermissao("gerente", p)).toBe(true);
    }
  });

  it("podeGerenciarFuncionario é igual para os dois e negado aos demais cargos", () => {
    const cargos = ["proprietario", "gerente", "caixa", "estoquista", "frentista"] as const;
    for (const alvo of cargos) {
      expect(podeGerenciarFuncionario("proprietario", alvo)).toBe(true);
      expect(podeGerenciarFuncionario("gerente", alvo)).toBe(true);
      for (const outro of ["caixa", "estoquista", "frentista"] as const) {
        expect(podeGerenciarFuncionario(outro, alvo)).toBe(false);
      }
    }
  });

  it("frentista, caixa e estoquista seguem sem acesso administrativo", () => {
    for (const c of ["frentista", "caixa", "estoquista"] as const) {
      expect(possuiPermissao(c, "funcionarios.gerenciar")).toBe(false);
      expect(possuiPermissao(c, "produtos.editar")).toBe(false);
      expect(possuiPermissao(c, "clientes.gerenciar")).toBe(false);
      expect(possuiPermissao(c, "contas_receber.registrar_pagamento")).toBe(false);
    }
  });

  it("PIN offline continua restrito a quem só vende", () => {
    expect(cargoPodeUsarPinOffline("gerente")).toBe(false);
    expect(cargoPodeUsarPinOffline("proprietario")).toBe(false);
    expect(cargoPodeUsarPinOffline("caixa")).toBe(true);
  });
});
