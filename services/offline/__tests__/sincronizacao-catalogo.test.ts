import { describe, it, expect, beforeEach } from "vitest";
import { aplicarAlteracoesCatalogoLocal } from "../sincronizacao-catalogo.service";
import { listarProdutosLocal, buscarProdutosLocalPorTermo } from "../produtos-local.service";
import { listarCategoriasLocal } from "../categorias-local.service";
import { listarEstoqueLocal } from "../estoque-local.service";
import { getOfflineDB } from "../db";
import type { AlteracoesCatalogo } from "@/lib/offline-sync/actions";

beforeEach(async () => {
  const db = getOfflineDB();
  await db.produtos_local.clear();
  await db.categorias_local.clear();
  await db.estoque_local.clear();
});

function alteracoes(over: Partial<AlteracoesCatalogo>): AlteracoesCatalogo {
  return {
    produtos: [],
    categorias: [],
    estoque: [],
    timestampServidor: new Date().toISOString(),
    ...over,
  };
}

describe("aplicarAlteracoesCatalogoLocal — sincronização inicial", () => {
  it("grava o catálogo inteiro localmente na primeira sincronização", async () => {
    await aplicarAlteracoesCatalogoLocal(
      alteracoes({
        produtos: [
          {
            id: "p1",
            nome: "Refrigerante",
            preco_venda: 5,
            preco_custo: 3,
            codigo_barras: "111",
            categoria_id: "c1",
            estoque_minimo: 5,
            unidade: "un",
            ativo: true,
            created_at: "",
            updated_at: "",
            deleted_at: null,
          } as any,
        ],
        categorias: [{ id: "c1", nome: "Bebidas", ativo: true }],
      })
    );

    const produtos = await listarProdutosLocal();
    const categorias = await listarCategoriasLocal();

    expect(produtos).toHaveLength(1);
    expect(produtos[0].nome).toBe("Refrigerante");
    expect(categorias).toHaveLength(1);
  });
});

describe("aplicarAlteracoesCatalogoLocal — sincronização incremental", () => {
  it("atualiza só o produto alterado, preservando os demais já sincronizados", async () => {
    await aplicarAlteracoesCatalogoLocal(
      alteracoes({
        produtos: [
          produtoServidor({ id: "p1", nome: "Água", preco_venda: 2 }),
          produtoServidor({ id: "p2", nome: "Suco", preco_venda: 4 }),
        ],
      })
    );

    // segunda sincronização: só p2 mudou
    await aplicarAlteracoesCatalogoLocal(
      alteracoes({ produtos: [produtoServidor({ id: "p2", nome: "Suco", preco_venda: 6 })] })
    );

    const produtos = await listarProdutosLocal();
    const p1 = produtos.find((p) => p.id === "p1");
    const p2 = produtos.find((p) => p.id === "p2");

    expect(p1?.preco_venda).toBe(2); // não foi tocado na segunda sync
    expect(p2?.preco_venda).toBe(6); // atualizado
  });

  it("reflete atualização de preço no produto já sincronizado", async () => {
    await aplicarAlteracoesCatalogoLocal(
      alteracoes({ produtos: [produtoServidor({ id: "p1", preco_venda: 10 })] })
    );
    await aplicarAlteracoesCatalogoLocal(
      alteracoes({ produtos: [produtoServidor({ id: "p1", preco_venda: 15 })] })
    );

    const [produto] = await listarProdutosLocal();
    expect(produto.preco_venda).toBe(15);
  });

  it("reflete atualização de estoque", async () => {
    await aplicarAlteracoesCatalogoLocal(
      alteracoes({
        estoque: [{ produto_id: "p1", nome: "Água", estoque_minimo: 5, quantidade_atual: 20 }],
      })
    );
    await aplicarAlteracoesCatalogoLocal(
      alteracoes({
        estoque: [{ produto_id: "p1", nome: "Água", estoque_minimo: 5, quantidade_atual: 12 }],
      })
    );

    const [estoque] = await listarEstoqueLocal();
    expect(estoque.quantidade_atual).toBe(12);
  });
});

describe("aplicarAlteracoesCatalogoLocal — produto desativado", () => {
  it("produto desativado no servidor some das buscas locais, sem precisar de exclusão física", async () => {
    await aplicarAlteracoesCatalogoLocal(
      alteracoes({ produtos: [produtoServidor({ id: "p1", nome: "Descontinuado", ativo: true })] })
    );
    expect(await listarProdutosLocal()).toHaveLength(1);

    await aplicarAlteracoesCatalogoLocal(
      alteracoes({ produtos: [produtoServidor({ id: "p1", nome: "Descontinuado", ativo: false })] })
    );

    expect(await listarProdutosLocal()).toHaveLength(0);
    // continua fisicamente no banco local (histórico), só não aparece nas listagens
    const db = getOfflineDB();
    expect(await db.produtos_local.get("p1")).toBeDefined();
  });

  it("produto com deleted_at preenchido é tratado como inativo mesmo se ativo=true", async () => {
    await aplicarAlteracoesCatalogoLocal(
      alteracoes({
        produtos: [produtoServidor({ id: "p1", ativo: true, deleted_at: "2026-01-01T00:00:00Z" })],
      })
    );

    expect(await listarProdutosLocal()).toHaveLength(0);
  });
});

describe("buscarProdutosLocalPorTermo — funcionamento sem internet", () => {
  // Nenhuma chamada de rede acontece nesta função — ela só lê o Dexie
  // já sincronizado. Este teste roda sem qualquer mock de servidor
  // disponível, provando que a busca não depende de conexão.
  it("busca por nome (parcial, sem diferenciar maiúsculas)", async () => {
    await aplicarAlteracoesCatalogoLocal(
      alteracoes({ produtos: [produtoServidor({ id: "p1", nome: "Refrigerante Cola" })] })
    );

    const resultados = await buscarProdutosLocalPorTermo("cola");
    expect(resultados).toHaveLength(1);
  });

  it("busca por código de barras exato", async () => {
    await aplicarAlteracoesCatalogoLocal(
      alteracoes({ produtos: [produtoServidor({ id: "p1", codigo_barras: "789123" })] })
    );

    const resultados = await buscarProdutosLocalPorTermo("789123");
    expect(resultados).toHaveLength(1);
    expect(resultados[0].id).toBe("p1");
  });

  it("não retorna produto inativo mesmo que o termo bata", async () => {
    await aplicarAlteracoesCatalogoLocal(
      alteracoes({ produtos: [produtoServidor({ id: "p1", nome: "Água", ativo: false })] })
    );

    expect(await buscarProdutosLocalPorTermo("água")).toHaveLength(0);
  });
});

function produtoServidor(over: {
  id: string;
  nome?: string;
  preco_venda?: number;
  codigo_barras?: string | null;
  ativo?: boolean;
  deleted_at?: string | null;
}) {
  return {
    id: over.id,
    nome: over.nome ?? "Produto",
    preco_venda: over.preco_venda ?? 1,
    preco_custo: 1,
    codigo_barras: over.codigo_barras ?? null,
    categoria_id: "c1",
    estoque_minimo: 0,
    unidade: "un",
    ativo: over.ativo ?? true,
    created_at: "",
    updated_at: new Date().toISOString(),
    deleted_at: over.deleted_at ?? null,
  } as any;
}
