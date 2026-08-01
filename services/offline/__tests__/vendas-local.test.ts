import { describe, it, expect, beforeEach, vi } from "vitest";
import { registrarVendaLocal, listarVendasLocaisPendentes, buscarItensDaVendaLocal } from "../vendas-local.service";
import { listarAuditoriaLocal } from "../auditoria-local.service";
import { getOfflineDB } from "../db";
import { ItemCarrinho } from "@/lib/vendas/carrinho";

beforeEach(async () => {
  const db = getOfflineDB();
  await Promise.all([
    db.vendas_locais.clear(),
    db.itens_venda_locais.clear(),
    db.estoque_local.clear(),
    db.fila_sincronizacao.clear(),
    db.carrinho_local.clear(),
    db.auditoria_local.clear(),
    db.configuracoes_local.clear(),
  ]);
  await db.estoque_local.bulkPut([
    { produto_id: "p1", quantidade_atual: 100, estoque_minimo: 0, updated_at: "" },
    { produto_id: "p2", quantidade_atual: 100, estoque_minimo: 0, updated_at: "" },
  ]);
});

const itensExemplo: ItemCarrinho[] = [
  { produto_id: "p1", nome: "Água", preco_unitario: 3, quantidade: 2 },
  { produto_id: "p2", nome: "Refrigerante", preco_unitario: 5, quantidade: 1 },
];

function dadosVenda(itens: ItemCarrinho[] = itensExemplo) {
  return {
    itens,
    formaPagamento: "pix" as const,
    funcionarioId: "func-1",
    funcionarioNome: "Maria",
  };
}

describe("registrarVendaLocal — venda e itens", () => {
  it("grava a venda e todos os itens localmente, com total correto", async () => {
    const resultado = await registrarVendaLocal(dadosVenda());
    expect(resultado.sucesso).toBe(true);

    const db = getOfflineDB();
    const venda = await db.vendas_locais.get(resultado.vendaId!);
    const itens = await buscarItensDaVendaLocal(resultado.vendaId!);

    expect(venda?.total).toBe(11);
    expect(venda?.status).toBe("pendente_sincronizacao");
    expect(venda?.funcionario_nome).toBe("Maria");
    expect(itens).toHaveLength(2);
  });

  it("aparece em listarVendasLocaisPendentes", async () => {
    await registrarVendaLocal(dadosVenda());
    const pendentes = await listarVendasLocaisPendentes();
    expect(pendentes).toHaveLength(1);
  });
});

describe("registrarVendaLocal — estoque local", () => {
  it("reduz o estoque local pela quantidade vendida", async () => {
    const db = getOfflineDB();
    await db.estoque_local.put({ produto_id: "p1", quantidade_atual: 10, estoque_minimo: 2, updated_at: "" });

    await registrarVendaLocal(dadosVenda([{ produto_id: "p1", nome: "Água", preco_unitario: 3, quantidade: 4 }]));

    const estoque = await db.estoque_local.get("p1");
    expect(estoque?.quantidade_atual).toBe(6);
  });

  it("Etapa 8.2: bloqueia a venda quando a quantidade pedida é maior que o disponível", async () => {
    const db = getOfflineDB();
    await db.estoque_local.put({ produto_id: "p1", quantidade_atual: 3, estoque_minimo: 0, updated_at: "" });

    const resultado = await registrarVendaLocal(
      dadosVenda([{ produto_id: "p1", nome: "Água", preco_unitario: 3, quantidade: 5 }])
    );

    expect(resultado.sucesso).toBe(false);
    expect(resultado.erro).toContain("Estoque insuficiente");

    const estoque = await db.estoque_local.get("p1");
    expect(estoque?.quantidade_atual).toBe(3);
    expect(await db.vendas_locais.count()).toBe(0);

    const eventoBloqueio = (await listarAuditoriaLocal()).find((e) => e.tipo === "venda_bloqueada_estoque");
    expect(eventoBloqueio).toBeDefined();
  });

  it("bloqueia a venda de um produto sem nenhum registro de estoque local (tratado como 0 disponível)", async () => {
    const resultado = await registrarVendaLocal(
      dadosVenda([{ produto_id: "p-novo", nome: "Novo", preco_unitario: 2, quantidade: 1 }])
    );

    expect(resultado.sucesso).toBe(false);
    const db = getOfflineDB();
    expect(await db.vendas_locais.count()).toBe(0);
  });
});

describe("registrarVendaLocal — fila de sincronização", () => {
  it("cria um item pendente na fila com o mesmo id da venda", async () => {
    const resultado = await registrarVendaLocal(dadosVenda());

    const db = getOfflineDB();
    const itemFila = await db.fila_sincronizacao.get(resultado.vendaId!);

    expect(itemFila).toBeDefined();
    expect(itemFila?.status).toBe("pendente");
    expect(itemFila?.tipo).toBe("venda");
  });

  it("não envia nada para fora — só grava localmente (fase 3 não sincroniza)", async () => {
    const resultado = await registrarVendaLocal(dadosVenda());
    expect(resultado.sucesso).toBe(true);
  });
});

describe("registrarVendaLocal — auditoria", () => {
  it("registra início, criação da fila e conclusão, com duração medida", async () => {
    const resultado = await registrarVendaLocal(dadosVenda());
    const eventos = await listarAuditoriaLocal();

    const tipos = eventos.map((e) => e.tipo);
    expect(tipos).toContain("venda_iniciada");
    expect(tipos).toContain("fila_item_criado");
    expect(tipos).toContain("venda_concluida");

    const conclusao = eventos.find((e) => e.tipo === "venda_concluida");
    expect(conclusao?.venda_id).toBe(resultado.vendaId);
    expect(conclusao?.duracao_ms).not.toBeNull();
    expect(conclusao?.funcionario_id).toBe("func-1");
  });
});

describe("registrarVendaLocal — transação atômica", () => {
  it("se qualquer parte falhar, nada fica gravado (nem venda, nem itens, nem fila)", async () => {
    const db = getOfflineDB();
    const falhaSimulada = vi
      .spyOn(db.carrinho_local, "clear")
      .mockRejectedValueOnce(new Error("falha simulada no meio da transação"));

    const resultado = await registrarVendaLocal(dadosVenda());

    expect(resultado.sucesso).toBe(false);
    expect(await db.vendas_locais.count()).toBe(0);
    expect(await db.itens_venda_locais.count()).toBe(0);
    expect(await db.fila_sincronizacao.count()).toBe(0);

    const eventoErro = (await listarAuditoriaLocal()).find((e) => e.tipo === "venda_erro");
    expect(eventoErro).toBeDefined();

    falhaSimulada.mockRestore();
  });
});