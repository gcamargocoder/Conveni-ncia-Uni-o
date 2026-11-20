import { describe, expect, it } from "vitest";
import { janelaDoFiltro, lerFiltroVendas, paraQueryString } from "../filtro";
import { montarWhereVendas } from "@/services/relatorios.service";
import { instanteLocal } from "@/lib/utils/fuso";

const AGORA = new Date("2026-11-19T00:50:00.000Z"); // 18/11/2026 21:50 em Brasília (já é dia 19 em UTC)
const F1 = "11111111-1111-4111-8111-111111111111";

describe("lerFiltroVendas", () => {
  it("'hoje' é o dia da LOJA: às 21h50 do dia 18 (00h50 UTC do 19), hoje ainda é 18", () => {
    const { filtro } = lerFiltroVendas({ periodo: "hoje" }, AGORA);
    expect(filtro.dataInicial).toBe("2026-11-18");
    expect(filtro.dataFinal).toBe("2026-11-18");
  });

  it("7 dias e 30 dias contam em dias do calendário da loja", () => {
    expect(lerFiltroVendas({ periodo: "7dias" }, AGORA).filtro.dataInicial).toBe("2026-11-11");
    expect(lerFiltroVendas({ periodo: "30dias" }, AGORA).filtro.dataInicial).toBe("2026-10-19");
  });

  it("sem parâmetros = 7 dias; preset desconhecido também", () => {
    expect(lerFiltroVendas({}, AGORA).preset).toBe("7dias");
    expect(lerFiltroVendas({ periodo: "xyz" }, AGORA).preset).toBe("7dias");
  });

  it("dia específico (só 'de') vale para o dia inteiro", () => {
    const { filtro, preset } = lerFiltroVendas({ de: "2026-11-18" }, AGORA);
    expect(preset).toBeNull();
    expect(filtro.dataInicial).toBe("2026-11-18");
    expect(filtro.dataFinal).toBe("2026-11-18");
  });

  it("combina todos os filtros", () => {
    const { filtro, avisos } = lerFiltroVendas(
      { de: "2026-11-18", ate: "2026-11-18", hi: "08:00", hf: "18:00", funcionario: F1, terminal: "terminal-A", caixa: F1, forma: "pix", situacao: "ativas" },
      AGORA
    );
    expect(avisos).toEqual([]);
    expect(filtro).toMatchObject({ horaInicial: "08:00", horaFinal: "18:00", funcionario_id: F1, terminal_id: "terminal-A", caixa_id: F1, forma: "pix", situacao: "ativas" });
  });

  it("descarta valores inválidos com aviso (nunca quebra, nunca vira filtro estranho)", () => {
    const { filtro, avisos } = lerFiltroVendas(
      { de: "2026-02-31", hi: "25:99", funcionario: "1; DROP TABLE vendas", forma: "cheque", situacao: "x" },
      AGORA
    );
    expect(filtro.funcionario_id).toBeNull();
    expect(filtro.forma).toBeNull();
    expect(filtro.horaInicial).toBeNull();
    expect(filtro.situacao).toBe("todas");
    expect(avisos.length).toBeGreaterThanOrEqual(4);
  });

  it("intervalo invertido é corrigido; horário final < inicial no mesmo dia é ignorado", () => {
    expect(lerFiltroVendas({ de: "2026-11-18", ate: "2026-11-10" }, AGORA).filtro).toMatchObject({ dataInicial: "2026-11-10", dataFinal: "2026-11-18" });
    expect(lerFiltroVendas({ de: "2026-11-18", hi: "18:00", hf: "08:00" }, AGORA).filtro).toMatchObject({ horaInicial: null, horaFinal: null });
  });

  it("a query string canônica reproduz o mesmo filtro (tela == exportação)", () => {
    const { filtro } = lerFiltroVendas(
      { de: "2026-11-18", ate: "2026-11-19", hi: "08:00", hf: "18:00", funcionario: F1, forma: "credito", situacao: "canceladas" },
      AGORA
    );
    const deNovo = lerFiltroVendas(Object.fromEntries(new URLSearchParams(paraQueryString(filtro))), AGORA).filtro;
    expect(deNovo).toEqual(filtro);
  });
});

describe("montarWhereVendas — janela no horário da loja", () => {
  it("08:00–18:00 do dia 18 vira [11:00Z, 21:01Z) e usa 'lt' no fim", () => {
    const { filtro } = lerFiltroVendas({ de: "2026-11-18", ate: "2026-11-18", hi: "08:00", hf: "18:00" }, AGORA);
    const j = janelaDoFiltro(filtro);
    expect(j.inicio.toISOString()).toBe("2026-11-18T11:00:00.000Z");
    expect(j.fim.toISOString()).toBe("2026-11-18T21:01:00.000Z");
    const where = montarWhereVendas(filtro) as { AND: { created_at?: { gte: Date; lt: Date } }[] };
    expect(where.AND[0].created_at).toEqual({ gte: j.inicio, lt: j.fim });
  });

  it("dia inteiro 18: a venda 21h44 (00:44Z do dia 19) está dentro; 00h00 do dia 19 está fora", () => {
    const { filtro } = lerFiltroVendas({ de: "2026-11-18" }, AGORA);
    const { inicio, fim } = janelaDoFiltro(filtro);
    const venda = new Date("2026-11-19T00:44:11.000Z");
    expect(venda >= inicio && venda < fim).toBe(true);
    expect(instanteLocal("2026-11-19", "00:00:00") < fim).toBe(false);
  });

  it("filtros entram em conjunto (AND) e forma casa venda dividida pelo pagamento", () => {
    const { filtro } = lerFiltroVendas({ de: "2026-11-18", funcionario: F1, terminal: F1, caixa: F1, forma: "pix", situacao: "ativas" }, AGORA);
    const where = montarWhereVendas(filtro) as { AND: object[] };
    expect(where.AND).toHaveLength(6);
    expect(JSON.stringify(where.AND)).toContain('"forma_pagamento":"pix"');
    expect(JSON.stringify(where.AND)).toContain('"cancelada":false');
  });
});
