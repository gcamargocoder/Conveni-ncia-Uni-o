import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const prismaMock = vi.hoisted(() => ({
  funcionario: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), create: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock("../prisma/client", () => ({ prisma: prismaMock }));

import {
  listarFuncionarios,
  buscarFuncionarioPorId,
  autenticarPorPin,
  criarProprietarioInicial,
  ProprietarioJaConfiguradoError,
} from "../funcionarios.service";
import { gerarHashPin } from "@/lib/auth/pin";

const data = new Date("2026-01-01T00:00:00Z");
// Linha "suja": simula um banco/ORM que devolveu o hash apesar do select (defesa em profundidade).
const linhaComHash = {
  id: "f1",
  nome: "Maria",
  cargo: "caixa",
  ativo: true,
  created_at: data,
  updated_at: data,
  deleted_at: null,
  pin_hash: "$2a$10$hashsecreto",
};

beforeEach(() => vi.clearAllMocks());

describe("funcionários entregues à interface não contêm pin_hash", () => {
  it("listarFuncionarios: select explícito sem pin_hash e resposta sem o campo", async () => {
    prismaMock.funcionario.findMany.mockResolvedValue([linhaComHash]);
    const lista = await listarFuncionarios();

    const select = prismaMock.funcionario.findMany.mock.calls[0][0].select;
    expect(select).toBeDefined();
    expect(select).not.toHaveProperty("pin_hash");
    expect(JSON.stringify(lista)).not.toContain("pin_hash");
    expect(JSON.stringify(lista)).not.toContain("hashsecreto");
    expect(lista[0]).toMatchObject({ id: "f1", nome: "Maria", cargo: "caixa" });
  });

  it("buscarFuncionarioPorId: sem pin_hash", async () => {
    prismaMock.funcionario.findUnique.mockResolvedValue(linhaComHash);
    const f = await buscarFuncionarioPorId("f1");
    expect(prismaMock.funcionario.findUnique.mock.calls[0][0].select).not.toHaveProperty("pin_hash");
    expect(f).not.toHaveProperty("pin_hash");
  });

  it("autenticarPorPin devolve o funcionário sem o hash", async () => {
    const pin_hash = await gerarHashPin("1234");
    prismaMock.funcionario.findMany.mockResolvedValue([{ ...linhaComHash, pin_hash }]);
    const f = await autenticarPorPin("1234");
    expect(f).toMatchObject({ id: "f1" });
    expect(f).not.toHaveProperty("pin_hash");
    expect(await autenticarPorPin("0000")).toBeNull();
  });

  it("a tela de edição recebe o tipo público (nunca o tipo com pin_hash)", () => {
    const raiz = path.resolve(__dirname, "../..");
    const modal = fs.readFileSync(path.join(raiz, "components/funcionarios/FuncionarioEditarModal.tsx"), "utf8");
    expect(modal).toContain("FuncionarioPublico");
    expect(modal).not.toMatch(/import \{[^}]*\bFuncionario\b[^}]*\} from "@\/types\/funcionario"/);
    const pagina = fs.readFileSync(path.join(raiz, "app/funcionarios/page.tsx"), "utf8");
    expect(pagina).not.toContain("pin_hash");
  });
});

describe("criarProprietarioInicial", () => {
  function simularTransacao(existentes: number) {
    const tx = {
      $executeRaw: vi.fn(),
      funcionario: { count: vi.fn().mockResolvedValue(existentes), create: vi.fn().mockResolvedValue({ id: "novo" }) },
    };
    prismaMock.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    return tx;
  }

  it("toma o advisory lock ANTES de contar e criar, na mesma transação", async () => {
    const tx = simularTransacao(0);
    const ordem: string[] = [];
    tx.$executeRaw.mockImplementation(async () => ordem.push("lock"));
    tx.funcionario.count.mockImplementation(async () => (ordem.push("count"), 0));
    tx.funcionario.create.mockImplementation(async () => (ordem.push("create"), { id: "novo" }));

    await criarProprietarioInicial({ nome: "Dono", pin: "4321" });
    expect(ordem).toEqual(["lock", "count", "create"]);
    const dados = tx.funcionario.create.mock.calls[0][0].data;
    expect(dados.cargo).toBe("proprietario");
    expect(dados.pin_hash).not.toBe("4321");
  });

  it("com proprietário existente recusa e não cria nada (não dá para assumir a conta)", async () => {
    const tx = simularTransacao(1);
    await expect(criarProprietarioInicial({ nome: "Intruso", pin: "9999" })).rejects.toBeInstanceOf(
      ProprietarioJaConfiguradoError
    );
    expect(tx.funcionario.create).not.toHaveBeenCalled();
  });
});
