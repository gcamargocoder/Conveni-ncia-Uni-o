import { describe, it, expect } from "vitest";
import { cargoPodeUsarPinOffline, cargosComPinOffline, possuiPermissao } from "../permissoes";

describe("permissões do caixa", () => {
  it("abrir/fechar/vender (pdv.vender) valem para caixa e frentista; sangria, suprimento, estorno e reabertura, não", () => {
    for (const cargo of ["caixa", "frentista"] as const) {
      expect(possuiPermissao(cargo, "pdv.vender")).toBe(true);
      expect(possuiPermissao(cargo, "caixa.movimentar")).toBe(false);
      expect(possuiPermissao(cargo, "caixa.reabrir")).toBe(false);
      expect(possuiPermissao(cargo, "caixa.consultar")).toBe(false);
      expect(possuiPermissao(cargo, "pdv.cancelar_venda")).toBe(false);
    }
  });

  it("proprietário e gerente têm as permissões administrativas do caixa", () => {
    for (const cargo of ["proprietario", "gerente"] as const) {
      for (const p of ["caixa.movimentar", "caixa.reabrir", "caixa.consultar", "pdv.cancelar_venda"] as const) {
        expect(possuiPermissao(cargo, p)).toBe(true);
      }
    }
  });

  it("estoquista não tem nenhuma permissão de caixa", () => {
    for (const p of ["pdv.vender", "caixa.movimentar", "caixa.reabrir", "caixa.consultar"] as const) {
      expect(possuiPermissao("estoquista", p)).toBe(false);
    }
  });

  it("o PIN offline continua restrito a quem SÓ vende (as novas permissões não ampliaram a lista)", () => {
    expect(cargosComPinOffline().sort()).toEqual(["caixa", "frentista"]);
    expect(cargoPodeUsarPinOffline("gerente")).toBe(false);
    expect(cargoPodeUsarPinOffline("proprietario")).toBe(false);
  });
});
