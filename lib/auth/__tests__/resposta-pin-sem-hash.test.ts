import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  verificarAcesso: vi.fn(),
  autenticarPorPin: vi.fn(),
  tentativaPin: { findUnique: vi.fn(), upsert: vi.fn() },
}));

vi.mock("@/lib/auth/servidor", () => ({ verificarAcesso: m.verificarAcesso, obterIp: async () => "1.2.3.4" }));
vi.mock("@/services/funcionarios.service", () => ({ autenticarPorPin: m.autenticarPorPin }));
vi.mock("@/services/prisma/client", () => ({ prisma: { tentativaPin: m.tentativaPin } }));

import { validarPinAction } from "../actions";

beforeEach(() => {
  vi.clearAllMocks();
  m.verificarAcesso.mockResolvedValue({ ok: true, sessao: {} });
  m.tentativaPin.findUnique.mockResolvedValue(null);
  m.tentativaPin.upsert.mockResolvedValue({});
});

describe("validarPinAction (resposta que chega ao navegador)", () => {
  it("devolve só id, nome e cargo — nunca o hash, mesmo que o serviço devolvesse um", async () => {
    m.autenticarPorPin.mockResolvedValue({ id: "f1", nome: "Ana", cargo: "gerente", pin_hash: "$2a$10$segredo", ativo: true });
    const r = await validarPinAction("1234");
    expect(r.sucesso).toBe(true);
    expect(r.funcionario).toEqual({ id: "f1", nome: "Ana", cargo: "gerente" });
    expect(JSON.stringify(r)).not.toContain("pin_hash");
    expect(JSON.stringify(r)).not.toContain("segredo");
  });

  it("PIN incorreto registra a tentativa (bloqueio por tentativas preservado) e não devolve funcionário", async () => {
    m.autenticarPorPin.mockResolvedValue(null);
    const r = await validarPinAction("0000");
    expect(r).toMatchObject({ sucesso: false, motivo: "pin_incorreto" });
    expect(r.funcionario).toBeUndefined();
    expect(m.tentativaPin.upsert).toHaveBeenCalled();
  });

  it("origem já bloqueada nem consulta os PINs", async () => {
    m.tentativaPin.findUnique.mockResolvedValue({
      tentativas_falhas: 5,
      bloqueado_ate: new Date(Date.now() + 60_000),
    });
    const r = await validarPinAction("1234");
    expect(r.motivo).toBe("bloqueado");
    expect(m.autenticarPorPin).not.toHaveBeenCalled();
  });
});
