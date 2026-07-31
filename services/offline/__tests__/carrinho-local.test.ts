import { describe, it, expect, beforeEach } from "vitest";
import { salvarCarrinhoLocal, carregarCarrinhoLocal, limparCarrinhoLocal } from "../carrinho-local.service";
import { getOfflineDB } from "../db";
import { ItemCarrinho } from "@/lib/vendas/carrinho";

beforeEach(async () => {
  const db = getOfflineDB();
  await db.carrinho_local.clear();
});

const carrinho: ItemCarrinho[] = [
  { produto_id: "p1", nome: "Água", preco_unitario: 3, quantidade: 2 },
  { produto_id: "p2", nome: "Suco", preco_unitario: 6, quantidade: 1 },
];

describe("persistência do carrinho", () => {
  it("salva e recupera o carrinho fielmente", async () => {
    await salvarCarrinhoLocal(carrinho);
    const recuperado = await carregarCarrinhoLocal();

    expect(recuperado).toHaveLength(2);
    expect(recuperado.find((i) => i.produto_id === "p1")?.quantidade).toBe(2);
  });

  it("recuperação após 'fechamento' — uma nova leitura encontra o mesmo estado salvo antes", async () => {
    await salvarCarrinhoLocal(carrinho);

    // Simula reabrir o app: nenhuma referência em memória é reutilizada,
    // só uma nova leitura do banco local — como aconteceria após F5,
    // travamento ou queda de energia.
    const apósReabrir = await carregarCarrinhoLocal();

    expect(apósReabrir).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ produto_id: "p1", quantidade: 2 }),
        expect.objectContaining({ produto_id: "p2", quantidade: 1 }),
      ])
    );
  });

  it("salvar novamente substitui o conteúdo anterior (sem duplicar)", async () => {
    await salvarCarrinhoLocal(carrinho);
    await salvarCarrinhoLocal([{ produto_id: "p1", nome: "Água", preco_unitario: 3, quantidade: 5 }]);

    const recuperado = await carregarCarrinhoLocal();
    expect(recuperado).toHaveLength(1);
    expect(recuperado[0].quantidade).toBe(5);
  });

  it("cancelamento explícito limpa o carrinho por completo", async () => {
    await salvarCarrinhoLocal(carrinho);
    await limparCarrinhoLocal();

    expect(await carregarCarrinhoLocal()).toHaveLength(0);
  });

  it("carrinho vazio não é perdido nem gera erro ao salvar", async () => {
    await salvarCarrinhoLocal([]);
    expect(await carregarCarrinhoLocal()).toHaveLength(0);
  });
});
