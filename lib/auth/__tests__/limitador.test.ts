import { describe, it, expect } from "vitest";
import {
  EstadoLimite,
  LIMITE_LOGIN_CONTA,
  bloqueioRestanteMs,
  formatarEspera,
  registrarFalhaEstado,
} from "../limitador";

const T0 = new Date("2026-01-01T12:00:00Z");
const depois = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60 * 1000;

function falharVezes(n: number, inicio: Date, estado: EstadoLimite | null = null): EstadoLimite {
  let atual = estado;
  for (let i = 0; i < n; i++) atual = registrarFalhaEstado(atual, new Date(inicio.getTime() + i * 1000), LIMITE_LOGIN_CONTA);
  return atual!;
}

describe("limitador — bloqueio progressivo", () => {
  it("não bloqueia antes do limite", () => {
    const estado = falharVezes(4, T0);
    expect(estado.bloqueado_ate).toBeNull();
    expect(bloqueioRestanteMs(estado, depois(5000))).toBe(0);
  });

  it("bloqueia 1 minuto na 5ª falha", () => {
    const estado = falharVezes(5, T0);
    expect(estado.nivel).toBe(1);
    expect(bloqueioRestanteMs(estado, depois(4000))).toBeGreaterThan(55 * 1000);
    expect(bloqueioRestanteMs(estado, depois(5000 + MIN + 1))).toBe(0);
  });

  it("o segundo bloqueio é maior (5 min), depois 15 min", () => {
    let estado = falharVezes(5, T0);
    const t1 = depois(2 * MIN);
    estado = falharVezes(5, t1, estado);
    expect(estado.nivel).toBe(2);
    expect(estado.bloqueado_ate!.getTime() - (t1.getTime() + 4000)).toBe(5 * MIN);

    const t2 = depois(10 * MIN);
    estado = falharVezes(5, t2, estado);
    expect(estado.nivel).toBe(3);
    expect(estado.bloqueado_ate!.getTime() - (t2.getTime() + 4000)).toBe(15 * MIN);
  });

  it("o degrau máximo se repete (não passa de 4 h)", () => {
    let estado: EstadoLimite | null = null;
    for (let rodada = 0; rodada < 9; rodada++) {
      estado = falharVezes(5, depois(rodada * 5 * 60 * MIN), estado);
    }
    const ultimo = depois(8 * 5 * 60 * MIN);
    expect(estado!.bloqueado_ate!.getTime() - (ultimo.getTime() + 4000)).toBe(4 * 60 * MIN);
  });

  it("falhas antigas (fora da janela de 15 min) são esquecidas", () => {
    let estado = falharVezes(4, T0);
    estado = registrarFalhaEstado(estado, depois(20 * MIN), LIMITE_LOGIN_CONTA);
    expect(estado.falhas).toBe(1);
    expect(estado.bloqueado_ate).toBeNull();
  });

  it("após 24 h sem tentativas o degrau volta a zero (expiração automática)", () => {
    let estado = falharVezes(5, T0);
    expect(estado.nivel).toBe(1);
    estado = registrarFalhaEstado(estado, depois(25 * 60 * MIN), LIMITE_LOGIN_CONTA);
    expect(estado.nivel).toBe(0);
    expect(estado.falhas).toBe(1);
  });

  it("falhar durante o bloqueio não zera o contador do bloqueio", () => {
    const bloqueado = falharVezes(5, T0);
    const aindaBloqueado = registrarFalhaEstado(bloqueado, depois(10 * 1000), LIMITE_LOGIN_CONTA);
    expect(bloqueioRestanteMs(aindaBloqueado, depois(10 * 1000))).toBeGreaterThan(0);
  });
});

describe("formatarEspera", () => {
  it("formata minutos e horas", () => {
    expect(formatarEspera(20 * 1000)).toBe("1 minuto");
    expect(formatarEspera(5 * MIN)).toBe("5 minutos");
    expect(formatarEspera(60 * MIN)).toBe("1 hora");
    expect(formatarEspera(4 * 60 * MIN)).toBe("4 horas");
  });
});
