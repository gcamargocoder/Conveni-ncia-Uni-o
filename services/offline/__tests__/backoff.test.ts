import { describe, it, expect } from "vitest";
import { calcularAtrasoBackoff, elegivelParaTentativa } from "../worker-sincronizacao.service";
import type { ItemFilaSincronizacao } from "../db";

describe("calcularAtrasoBackoff", () => {
  it("segue a progressão 2s, 5s, 10s, 30s, 1min, 5min (Fase 6.5)", () => {
    expect(calcularAtrasoBackoff(0)).toBe(0);
    expect(calcularAtrasoBackoff(1)).toBe(2000);
    expect(calcularAtrasoBackoff(2)).toBe(5000);
    expect(calcularAtrasoBackoff(3)).toBe(10000);
    expect(calcularAtrasoBackoff(4)).toBe(30000);
    expect(calcularAtrasoBackoff(5)).toBe(60000);
    expect(calcularAtrasoBackoff(6)).toBe(300000);
  });

  it("nunca ultrapassa o teto de 5min, mesmo com muitas tentativas", () => {
    expect(calcularAtrasoBackoff(20)).toBe(300000);
  });
});

function item(over: Partial<ItemFilaSincronizacao>): ItemFilaSincronizacao {
  return {
    id: "1",
    tipo: "venda",
    payload: "{}",
    status: "erro",
    tentativas: 0,
    criado_em: "",
    ultima_tentativa_em: null,
    erro: null,
    ...over,
  };
}

describe("elegivelParaTentativa", () => {
  it("primeira tentativa é sempre elegível", () => {
    expect(elegivelParaTentativa(item({ tentativas: 0, ultima_tentativa_em: null }))).toBe(true);
  });

  it("não é elegível antes do tempo de backoff passar", () => {
    const agora = Date.now();
    const ultimaTentativa = new Date(agora - 1000).toISOString();
    expect(elegivelParaTentativa(item({ tentativas: 1, ultima_tentativa_em: ultimaTentativa }), agora)).toBe(false);
  });

  it("volta a ser elegível depois do tempo de backoff (retomada automática)", () => {
    const agora = Date.now();
    const ultimaTentativa = new Date(agora - 3000).toISOString();
    expect(elegivelParaTentativa(item({ tentativas: 1, ultima_tentativa_em: ultimaTentativa }), agora)).toBe(true);
  });
});