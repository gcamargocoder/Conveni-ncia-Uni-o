import { describe, it, expect, beforeEach } from "vitest";
import {
  enfileirar,
  listarPendentes,
  contarPendentes,
  atualizarStatus,
  incrementarTentativas,
  removerDaFila,
  lerPayload,
} from "../fila-sincronizacao.service";
import { getOfflineDB } from "../db";

// Cada teste começa com a fila vazia — evita um teste vazar estado para o outro.
beforeEach(async () => {
  const db = getOfflineDB();
  await db.fila_sincronizacao.clear();
});

describe("enfileirar", () => {
  it("adiciona um item com status pendente e zero tentativas", async () => {
    await enfileirar("venda-1", "venda", { total: 10 });
    const pendentes = await listarPendentes();

    expect(pendentes).toHaveLength(1);
    expect(pendentes[0].status).toBe("pendente");
    expect(pendentes[0].tentativas).toBe(0);
  });

  it("usa o mesmo id para substituir (idempotência) em vez de duplicar", async () => {
    await enfileirar("venda-1", "venda", { total: 10 });
    await enfileirar("venda-1", "venda", { total: 10 }); // reenvio do mesmo id

    const pendentes = await listarPendentes();
    expect(pendentes).toHaveLength(1);
  });

  it("guarda o payload serializado, recuperável via lerPayload", async () => {
    await enfileirar("venda-1", "venda", { total: 42, itens: ["a", "b"] });
    const [item] = await listarPendentes();

    const payload = lerPayload<{ total: number; itens: string[] }>(item);
    expect(payload.total).toBe(42);
    expect(payload.itens).toEqual(["a", "b"]);
  });
});

describe("contarPendentes", () => {
  it("conta pendente e erro, mas não sincronizado", async () => {
    await enfileirar("1", "venda", {});
    await enfileirar("2", "venda", {});
    await enfileirar("3", "venda", {});
    await atualizarStatus("2", "erro", "falha de rede");
    await atualizarStatus("3", "sincronizado");

    expect(await contarPendentes()).toBe(2); // "1" pendente + "2" erro
  });
});

describe("atualizarStatus", () => {
  it("atualiza o status e registra o horário da tentativa", async () => {
    await enfileirar("1", "movimentacao_estoque", {});
    await atualizarStatus("1", "erro", "sem conexão");

    const db = getOfflineDB();
    const item = await db.fila_sincronizacao.get("1");

    expect(item?.status).toBe("erro");
    expect(item?.erro).toBe("sem conexão");
    expect(item?.ultima_tentativa_em).not.toBeNull();
  });
});

describe("incrementarTentativas", () => {
  it("incrementa o contador a cada chamada", async () => {
    await enfileirar("1", "venda", {});
    await incrementarTentativas("1");
    await incrementarTentativas("1");

    const db = getOfflineDB();
    const item = await db.fila_sincronizacao.get("1");
    expect(item?.tentativas).toBe(2);
  });
});

describe("removerDaFila", () => {
  it("remove o item — sincronizado com sucesso não deve mais aparecer na fila", async () => {
    await enfileirar("1", "venda", {});
    await removerDaFila("1");

    expect(await listarPendentes()).toHaveLength(0);
  });
});
