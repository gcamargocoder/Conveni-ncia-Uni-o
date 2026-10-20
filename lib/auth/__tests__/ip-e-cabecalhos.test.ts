import { describe, it, expect } from "vitest";
import nextConfig from "../../../next.config";
import { normalizarIp } from "../ip";

describe("normalizarIp (chave do limitador)", () => {
  it.each([
    ["203.0.113.50", "203.0.113.50"],
    ["203.000.113.050", "203.0.113.50"],
    ["  203.0.113.50 ", "203.0.113.50"],
    ["203.0.113.50:51234", "203.0.113.50"],
    ["::ffff:203.0.113.50", "203.0.113.50"],
    ["[::ffff:203.0.113.50]:443", "203.0.113.50"],
  ])("IPv4 %s → %s", (entrada, esperado) => {
    expect(normalizarIp(entrada)).toBe(esperado);
  });

  it("IPv6 de uma mesma /64 vira a mesma chave, em qualquer escrita", () => {
    const chaves = new Set(
      [
        "2001:db8:abcd:12::1",
        "2001:DB8:ABCD:0012:ffff:ffff:ffff:ffff",
        "[2001:db8:abcd:12:1:2:3:4]:8080",
        "2001:db8:abcd:12::%eth0",
      ].map(normalizarIp)
    );
    expect(chaves.size).toBe(1);
    expect([...chaves][0]).toBe("2001:db8:abcd:12::/64");
  });

  it("redes /64 diferentes têm chaves diferentes", () => {
    expect(normalizarIp("2001:db8:abcd:12::1")).not.toBe(normalizarIp("2001:db8:abcd:13::1"));
  });

  it.each([null, undefined, "", "abc", "999.1.1.1", "1.2.3", "::gggg"])("ilegível (%s) → desconhecido", (entrada) => {
    expect(normalizarIp(entrada as string)).toBe("desconhecido");
  });
});

describe("cabeçalhos das telas com token na URL", () => {
  it("redefinir-senha, ativar-conta e configurar-conta: sem cache e sem Referer", async () => {
    const regras = await nextConfig.headers!();
    const regra = regras.find((r) => r.source.includes("ativar-conta"));
    expect(regra).toBeDefined();
    expect(regra!.source).toContain("redefinir-senha");
    expect(regra!.source).toContain("configurar-conta");
    const valores = Object.fromEntries(regra!.headers.map((h) => [h.key, h.value]));
    expect(valores["Cache-Control"]).toBe("no-store");
    expect(valores["Referrer-Policy"]).toBe("no-referrer");
  });
});

import { ipDoCliente } from "../ip";

describe("ipDoCliente (origem confiável atrás do proxy)", () => {
  const com = (cab: Record<string, string>) => (n: string) => cab[n] ?? null;

  it("prefere x-real-ip, ignorando x-forwarded-for", () => {
    expect(ipDoCliente(com({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("203.0.113.5");
  });
  it("sem x-real-ip usa o ÚLTIMO item de x-forwarded-for, nunca o primeiro (forjável)", () => {
    expect(ipDoCliente(com({ "x-forwarded-for": "1.1.1.1, 9.9.9.9 , 203.0.113.5" }))).toBe("203.0.113.5");
  });
  it("sem nenhum cabeçalho: contador único 'desconhecido' (falha fechada)", () => {
    expect(ipDoCliente(com({}))).toBe("desconhecido");
    expect(ipDoCliente(com({ "x-forwarded-for": " , " }))).toBe("desconhecido");
  });
  it("limita o tamanho do valor", () => {
    expect(ipDoCliente(com({ "x-real-ip": "a".repeat(500) })).length).toBe(64);
  });
});
