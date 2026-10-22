import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  venda: { findFirst: vi.fn() },
  contaReceber: { findFirst: vi.fn() },
  cliente: { delete: vi.fn() },
}));
vi.mock("../prisma/client", () => ({ prisma: prismaMock }));

import { excluirCliente } from "../clientes.service";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.venda.findFirst.mockResolvedValue(null);
  prismaMock.contaReceber.findFirst.mockResolvedValue(null);
  prismaMock.cliente.delete.mockResolvedValue({});
});

describe("excluirCliente preserva a integridade referencial", () => {
  it("sem vendas nem contas a receber, exclui", async () => {
    await excluirCliente("c1");
    expect(prismaMock.cliente.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("com vendas, recusa e orienta a desativar", async () => {
    prismaMock.venda.findFirst.mockResolvedValue({ id: "v1" });
    await expect(excluirCliente("c1")).rejects.toThrow(/Desativar/);
    expect(prismaMock.cliente.delete).not.toHaveBeenCalled();
  });

  it("com contas a receber, recusa e orienta a desativar", async () => {
    prismaMock.contaReceber.findFirst.mockResolvedValue({ id: "cr1" });
    await expect(excluirCliente("c1")).rejects.toThrow(/contas a receber/);
    expect(prismaMock.cliente.delete).not.toHaveBeenCalled();
  });
});
