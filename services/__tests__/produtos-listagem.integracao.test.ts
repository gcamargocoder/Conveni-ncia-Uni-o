// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/services/prisma/client";
import { LIMITE_TELA_PRODUTOS, listarProdutosParaTela } from "../produtos.service";

/**
 * Listagem da tela Produtos contra PostgreSQL de teste (npm run test:integracao): total real mesmo acima do limite,
 * ordem alfabética, exclusão lógica respeitada e NENHUMA escrita (a tela só lê).
 */
async function limparTudo() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "movimentacoes_estoque", "itens_venda", "vendas", "produtos", "categorias", "funcionarios" RESTART IDENTITY CASCADE'
  );
}

let categoria = "";

async function criar(nomes: string[], extra: { deleted?: boolean } = {}) {
  await prisma.produto.createMany({
    data: nomes.map((nome) => ({ nome, categoria_id: categoria, preco_venda: 5, deleted_at: extra.deleted ? new Date() : null })),
  });
}

beforeEach(async () => {
  await limparTudo();
  categoria = (await prisma.categoria.create({ data: { nome: "Geral" } })).id;
});

afterAll(async () => {
  await limparTudo();
  await prisma.$disconnect();
});

describe("listarProdutosParaTela", () => {
  it("o teto da tela é 3.000", () => expect(LIMITE_TELA_PRODUTOS).toBe(3000));

  it("catálogo menor que o limite: devolve tudo, em ordem alfabética, e total igual", async () => {
    await criar(["Café", "Biscoito", "Água"]);
    const r = await listarProdutosParaTela(10);
    expect(r.total).toBe(3);
    expect(r.produtos).toHaveLength(3);
    expect(r.produtos.map((p) => p.nome)).toEqual([...r.produtos.map((p) => p.nome)].sort());
  });

  it("acima do limite: carrega só `limite`, mas o total é o cadastrado (a tela avisa quantos ficaram de fora)", async () => {
    await criar(Array.from({ length: 25 }, (_, i) => `Produto ${String(i).padStart(2, "0")}`));
    const r = await listarProdutosParaTela(10);
    expect(r.produtos).toHaveLength(10);
    expect(r.total).toBe(25);
    expect(r.produtos[0].nome).toBe("Produto 00");
  });

  it("produtos excluídos (exclusão lógica) não entram nem no total", async () => {
    await criar(["Ativo A", "Ativo B"]);
    await criar(["Excluído"], { deleted: true });
    const r = await listarProdutosParaTela(10);
    expect(r.total).toBe(2);
    expect(r.produtos.map((p) => p.nome)).not.toContain("Excluído");
  });

  it("preço vem como número (serializável para o componente de cliente) e a leitura não grava nada", async () => {
    await criar(["Água"]);
    const antes = await prisma.produto.findMany({ orderBy: { id: "asc" } });
    const r = await listarProdutosParaTela(10);
    expect(typeof r.produtos[0].preco_venda).toBe("number");
    const depois = await prisma.produto.findMany({ orderBy: { id: "asc" } });
    expect(depois).toEqual(antes);
    expect(await prisma.movimentacaoEstoque.count()).toBe(0);
  });

  it("catálogo vazio", async () => {
    expect(await listarProdutosParaTela(10)).toEqual({ produtos: [], total: 0 });
  });
});
