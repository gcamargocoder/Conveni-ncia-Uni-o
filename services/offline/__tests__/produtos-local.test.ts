import { describe, it, expect, beforeEach } from "vitest";
import {
  listarProdutosLocal,
  buscarProdutoLocalPorCodigoBarras,
  substituirCatalogoLocal,
} from "../produtos-local.service";
import { getOfflineDB, ProdutoLocal } from "../db";

beforeEach(async () => {
  const db = getOfflineDB();
  await db.produtos_local.clear();
});

const produto = (over: Partial<ProdutoLocal>): ProdutoLocal => ({
  id: "1",
  nome: "Refrigerante",
  preco_venda: 5,
  codigo_barras: "789",
  categoria_id: "cat-1",
  ativo: true,
  updated_at: new Date().toISOString(),
  ...over,
});

describe("listarProdutosLocal", () => {
  it("lista só produtos ativos, ordenados por nome", async () => {
    await substituirCatalogoLocal([
      produto({ id: "1", nome: "Água", ativo: true }),
      produto({ id: "2", nome: "Suco", ativo: false }),
      produto({ id: "3", nome: "Refrigerante", ativo: true }),
    ]);

    const lista = await listarProdutosLocal();

    expect(lista.map((p) => p.nome)).toEqual(["Água", "Refrigerante"]);
  });
});

describe("buscarProdutoLocalPorCodigoBarras", () => {
  it("encontra o produto pelo código de barras", async () => {
    await substituirCatalogoLocal([produto({ id: "1", codigo_barras: "12345" })]);

    const encontrado = await buscarProdutoLocalPorCodigoBarras("12345");
    expect(encontrado?.id).toBe("1");
  });

  it("retorna undefined quando não encontra", async () => {
    const encontrado = await buscarProdutoLocalPorCodigoBarras("inexistente");
    expect(encontrado).toBeUndefined();
  });
});
