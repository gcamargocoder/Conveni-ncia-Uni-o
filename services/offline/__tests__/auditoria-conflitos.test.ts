import { describe, it, expect, beforeEach } from "vitest";
import { registrarEventoAuditoriaLocal, contarConflitosResolvidos } from "../auditoria-local.service";
import { getOfflineDB } from "../db";

beforeEach(async () => {
  const db = getOfflineDB();
  await db.auditoria_local.clear();
});

describe("contarConflitosResolvidos", () => {
  it("conta eventos de sucesso marcados como conflito resolvido", async () => {
    await registrarEventoAuditoriaLocal("sync_item_sucesso", {
      venda_id: "v1",
      detalhes: "conflito resolvido: venda já existia no servidor (idempotência)",
    });
    await registrarEventoAuditoriaLocal("sync_item_sucesso", { venda_id: "v2" });

    expect(await contarConflitosResolvidos()).toBe(1);
  });

  it("retorna zero quando não há nenhum conflito registrado", async () => {
    await registrarEventoAuditoriaLocal("sync_item_sucesso", { venda_id: "v1" });

    expect(await contarConflitosResolvidos()).toBe(0);
  });

  it("não conta eventos de erro, mesmo que mencionem a palavra conflito por acaso", async () => {
    await registrarEventoAuditoriaLocal("sync_item_erro", {
      venda_id: "v1",
      detalhes: "erro genérico, nada a ver com conflito resolvido",
    });

    expect(await contarConflitosResolvidos()).toBe(0);
  });
});