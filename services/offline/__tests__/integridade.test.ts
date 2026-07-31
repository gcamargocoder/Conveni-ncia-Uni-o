import { describe, it, expect, beforeEach } from "vitest";
import { verificarIntegridadeFila } from "../integridade.service";
import { enfileirar } from "../fila-sincronizacao.service";
import { getOfflineDB } from "../db";
import type { PayloadVendaFila } from "@/lib/offline-sync/sincronizar-venda-action";

beforeEach(async () => {
  const db = getOfflineDB();
  await db.fila_sincronizacao.clear();
  await db.logs_tecnicos.clear();
});

const payloadValido: PayloadVendaFila = {
  funcionario_id: "func-1",
  forma_pagamento: "pix",
  total: 10,
  itens: [{ produto_id: "p1", quantidade: 1, preco_unitario: 10 }],
};

describe("verificarIntegridadeFila", () => {
  it("não encontra problema em um item válido", async () => {
    await enfileirar("venda-1", "venda", payloadValido);

    const problemas = await verificarIntegridadeFila();

    expect(problemas).toHaveLength(0);
    const db = getOfflineDB();
    expect((await db.fila_sincronizacao.get("venda-1"))?.status).toBe("pendente");
  });

  it("detecta e corrige payload que não é JSON válido", async () => {
    const db = getOfflineDB();
    await db.fila_sincronizacao.put({
      id: "venda-corrompida",
      tipo: "venda",
      payload: "{ isso não é json válido",
      status: "pendente",
      tentativas: 0,
      criado_em: new Date().toISOString(),
      ultima_tentativa_em: null,
      erro: null,
    });

    const problemas = await verificarIntegridadeFila();

    expect(problemas).toHaveLength(1);
    expect(problemas[0].motivo).toContain("JSON válido");

    const item = await db.fila_sincronizacao.get("venda-corrompida");
    expect(item?.status).toBe("erro");
    expect(item?.erro).toContain("JSON válido");
  });

  it("detecta payload de venda sem campos obrigatórios", async () => {
    await enfileirar("venda-incompleta", "venda", { funcionario_id: "func-1" });

    const problemas = await verificarIntegridadeFila();

    expect(problemas).toHaveLength(1);
    expect(problemas[0].motivo).toContain("incompleto");
  });

  it("detecta timestamp de criação inválido", async () => {
    const db = getOfflineDB();
    await db.fila_sincronizacao.put({
      id: "venda-data-ruim",
      tipo: "venda",
      payload: JSON.stringify(payloadValido),
      status: "pendente",
      tentativas: 0,
      criado_em: "isso não é uma data",
      ultima_tentativa_em: null,
      erro: null,
    });

    const problemas = await verificarIntegridadeFila();

    expect(problemas).toHaveLength(1);
    expect(problemas[0].motivo).toContain("timestamp");
  });

  it("registra um log técnico da categoria QUEUE para cada problema encontrado", async () => {
    await enfileirar("venda-incompleta", "venda", { funcionario_id: "func-1" });
    await verificarIntegridadeFila();

    const db = getOfflineDB();
    const logs = await db.logs_tecnicos.where("categoria").equals("QUEUE").toArray();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].nivel).toBe("erro");
  });

  it("itens de movimentação de estoque (fora de escopo desta fase) não geram problema de integridade", async () => {
    await enfileirar("mov-1", "movimentacao_estoque", { produto_id: "p1" });

    const problemas = await verificarIntegridadeFila();

    expect(problemas).toHaveLength(0);
  });
});