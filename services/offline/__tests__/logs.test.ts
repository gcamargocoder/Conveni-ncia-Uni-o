import { describe, it, expect, beforeEach } from "vitest";
import { registrarLog, listarLogs, limparLogsAntigos } from "../logs.service";
import { getOfflineDB } from "../db";

beforeEach(async () => {
  const db = getOfflineDB();
  await db.logs_tecnicos.clear();
});

describe("registrarLog / listarLogs", () => {
  it("registra e lista um log", async () => {
    await registrarLog("SYNC", "info", "Sincronização iniciada");

    const logs = await listarLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].categoria).toBe("SYNC");
    expect(logs[0].nivel).toBe("info");
  });

  it("filtra por categoria", async () => {
    await registrarLog("PIN", "info", "PIN validado");
    await registrarLog("PDV", "info", "Venda registrada");

    const logsPin = await listarLogs({ categoria: "PIN" });
    expect(logsPin).toHaveLength(1);
    expect(logsPin[0].categoria).toBe("PIN");
  });

  it("filtra por nível", async () => {
    await registrarLog("ESTOQUE", "info", "Movimentação ok");
    await registrarLog("ESTOQUE", "erro", "Falha na movimentação");

    const logsErro = await listarLogs({ nivel: "erro" });
    expect(logsErro).toHaveLength(1);
    expect(logsErro[0].nivel).toBe("erro");
  });

  it("lista do mais recente para o mais antigo", async () => {
    await registrarLog("DATABASE", "info", "primeiro");
    await new Promise((resolve) => setTimeout(resolve, 5)); // garante timestamp diferente do próximo log
    await registrarLog("DATABASE", "info", "segundo");

    const logs = await listarLogs();
    expect(logs[0].mensagem).toBe("segundo");
  });
});

describe("limparLogsAntigos", () => {
  it("remove só logs mais antigos que o limite, mantendo os recentes", async () => {
    const db = getOfflineDB();
    const antigo = new Date();
    antigo.setDate(antigo.getDate() - 30);

    await db.logs_tecnicos.put({
      id: "log-antigo",
      categoria: "SYNC",
      nivel: "info",
      mensagem: "antigo",
      detalhes: null,
      timestamp: antigo.toISOString(),
    });
    await registrarLog("SYNC", "info", "recente");

    const removidos = await limparLogsAntigos(14);

    expect(removidos).toBe(1);
    const restantes = await listarLogs();
    expect(restantes).toHaveLength(1);
    expect(restantes[0].mensagem).toBe("recente");
  });
});