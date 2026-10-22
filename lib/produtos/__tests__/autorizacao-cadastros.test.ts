import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  verificarAcesso: vi.fn(),
  validarPinAction: vi.fn(),
  criarProduto: vi.fn(),
  atualizarProduto: vi.fn(),
  desativarProduto: vi.fn(),
  criarCategoria: vi.fn(),
  atualizarCategoria: vi.fn(),
  excluirCategoria: vi.fn(),
  criarFornecedor: vi.fn(),
  atualizarFornecedor: vi.fn(),
  registrarMovimentacao: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "teste" }) }));
vi.mock("@/lib/auth/servidor", () => ({ verificarAcesso: m.verificarAcesso }));
vi.mock("@/lib/auth/actions", () => ({ validarPinAction: m.validarPinAction }));
vi.mock("@/services/produtos.service", () => ({
  criarProduto: m.criarProduto,
  atualizarProduto: m.atualizarProduto,
  desativarProduto: m.desativarProduto,
}));
vi.mock("@/services/categorias.service", () => ({
  criarCategoria: m.criarCategoria,
  atualizarCategoria: m.atualizarCategoria,
  excluirCategoria: m.excluirCategoria,
}));
vi.mock("@/services/fornecedores.service", () => ({
  criarFornecedor: m.criarFornecedor,
  atualizarFornecedor: m.atualizarFornecedor,
}));
vi.mock("@/services/estoque.service", () => ({ registrarMovimentacao: m.registrarMovimentacao }));

import {
  criarProdutoAction,
  atualizarProdutoAction,
  desativarProdutoAction,
  renomearProdutoAction,
  ajustarEstoqueMinimoAction,
} from "../actions";
import { criarCategoriaAction, atualizarCategoriaAction, excluirCategoriaAction } from "../categorias-actions";
import { criarFornecedorAction, atualizarFornecedorAction } from "../fornecedores-actions";
import { registrarMovimentacaoAction } from "@/lib/estoque/actions";

const produto = {
  nome: "Água 500ml",
  categoria_id: "c1",
  fornecedor_id: null,
  preco_venda: 5,
  preco_custo: 2,
  estoque_minimo: 10,
  codigo_barras: "",
  unidade: "un" as const,
  descricao: "",
  ativo: true,
};

// Cada operação administrativa de cadastro; `pin` é sempre o último argumento.
const OPERACOES: { nome: string; chamar: (pin: string) => Promise<{ sucesso: boolean; erroAutorizacao?: string }>; servico: () => ReturnType<typeof vi.fn> }[] = [
  { nome: "criarProdutoAction", chamar: (p) => criarProdutoAction(produto, p), servico: () => m.criarProduto },
  { nome: "atualizarProdutoAction", chamar: (p) => atualizarProdutoAction("p1", produto, p), servico: () => m.atualizarProduto },
  { nome: "desativarProdutoAction", chamar: (p) => desativarProdutoAction("p1", p), servico: () => m.desativarProduto },
  { nome: "renomearProdutoAction", chamar: (p) => renomearProdutoAction("p1", "Novo nome", p), servico: () => m.atualizarProduto },
  { nome: "ajustarEstoqueMinimoAction", chamar: (p) => ajustarEstoqueMinimoAction("p1", 5, p), servico: () => m.atualizarProduto },
  { nome: "criarCategoriaAction", chamar: (p) => criarCategoriaAction("Bebidas", p), servico: () => m.criarCategoria },
  { nome: "atualizarCategoriaAction", chamar: (p) => atualizarCategoriaAction("c1", "Bebidas", p), servico: () => m.atualizarCategoria },
  { nome: "excluirCategoriaAction", chamar: (p) => excluirCategoriaAction("c1", p), servico: () => m.excluirCategoria },
  { nome: "criarFornecedorAction", chamar: (p) => criarFornecedorAction({ nome: "Distribuidora" }, p), servico: () => m.criarFornecedor },
  { nome: "atualizarFornecedorAction", chamar: (p) => atualizarFornecedorAction("f1", { nome: "Distribuidora" }, p), servico: () => m.atualizarFornecedor },
];

const autorizarComo = (cargo: string) =>
  m.validarPinAction.mockResolvedValue({ sucesso: true, funcionario: { id: "x", nome: "X", cargo } });

beforeEach(() => {
  vi.clearAllMocks();
  m.verificarAcesso.mockResolvedValue({ ok: true, sessao: { usuario: { id: "u1", papel: "admin" } } });
  m.criarProduto.mockResolvedValue({});
  m.atualizarProduto.mockResolvedValue({});
  m.desativarProduto.mockResolvedValue({});
  m.criarCategoria.mockResolvedValue({ id: "c1", nome: "Bebidas" });
  m.atualizarCategoria.mockResolvedValue({ id: "c1", nome: "Bebidas" });
  m.excluirCategoria.mockResolvedValue(undefined);
  m.criarFornecedor.mockResolvedValue({ id: "f1", nome: "Distribuidora" });
  m.atualizarFornecedor.mockResolvedValue(undefined);
});

describe.each(OPERACOES)("$nome", ({ chamar, servico }) => {
  it.each(["proprietario", "gerente"])("PIN de %s autoriza", async (cargo) => {
    autorizarComo(cargo);
    const r = await chamar("1234");
    expect(r.sucesso).toBe(true);
    expect(m.validarPinAction).toHaveBeenCalledWith("1234");
    expect(servico()).toHaveBeenCalled();
  });

  it.each(["caixa", "frentista", "estoquista"])("PIN de %s é recusado no servidor", async (cargo) => {
    autorizarComo(cargo);
    const r = await chamar("1234");
    expect(r.sucesso).toBe(false);
    expect(r.erroAutorizacao).toBeTruthy();
    expect(servico()).not.toHaveBeenCalled();
  });

  it("PIN incorreto ou bloqueado é recusado", async () => {
    m.validarPinAction.mockResolvedValue({ sucesso: false, erro: "PIN incorreto." });
    const r = await chamar("0000");
    expect(r.sucesso).toBe(false);
    expect(r.erroAutorizacao).toBe("PIN incorreto.");
    expect(servico()).not.toHaveBeenCalled();
  });

  it("chamada direta sem PIN é recusada", async () => {
    m.validarPinAction.mockResolvedValue({ sucesso: false, erro: "PIN incorreto." });
    const r = await chamar("");
    expect(r.sucesso).toBe(false);
    expect(servico()).not.toHaveBeenCalled();
  });

  it("sem sessão de login nem chega a validar o PIN", async () => {
    m.verificarAcesso.mockResolvedValue({ ok: false, erro: "Sua sessão expirou." });
    const r = await chamar("1234");
    expect(r.sucesso).toBe(false);
    expect(m.validarPinAction).not.toHaveBeenCalled();
    expect(servico()).not.toHaveBeenCalled();
  });
});

describe("estoque continua autorizado pelo PIN e pelo cargo", () => {
  const entrada = { produto_id: "p1", tipo: "entrada" as const, quantidade: 5 };

  it.each(["proprietario", "gerente", "estoquista"])("%s registra entrada", async (cargo) => {
    autorizarComo(cargo);
    const r = await registrarMovimentacaoAction(entrada as never, "1234");
    expect(r.sucesso).toBe(true);
    expect(m.registrarMovimentacao).toHaveBeenCalledWith(expect.objectContaining({ funcionario_id: "x" }));
  });

  it.each(["caixa", "frentista"])("%s não registra entrada", async (cargo) => {
    autorizarComo(cargo);
    const r = await registrarMovimentacaoAction(entrada as never, "1234");
    expect(r.sucesso).toBe(false);
    expect(m.registrarMovimentacao).not.toHaveBeenCalled();
  });
});
