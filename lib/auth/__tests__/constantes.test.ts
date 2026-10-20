import { describe, it, expect } from "vitest";
import { destinoSeguro, rotaPublica } from "../constantes";
import { gerarToken, hashToken } from "../token";

describe("destinoSeguro (open redirect)", () => {
  it("aceita caminhos internos", () => {
    expect(destinoSeguro("/estoque")).toBe("/estoque");
    expect(destinoSeguro("/relatorios?de=2026-01-01")).toBe("/relatorios?de=2026-01-01");
  });

  it("recusa URLs externas e variações", () => {
    expect(destinoSeguro("https://malicioso.com")).toBe("/");
    expect(destinoSeguro("//malicioso.com")).toBe("/");
    expect(destinoSeguro("/\\malicioso.com")).toBe("/");
    expect(destinoSeguro("javascript:alert(1)")).toBe("/");
    expect(destinoSeguro("/ok\r\nSet-Cookie: x=1")).toBe("/");
    expect(destinoSeguro(undefined)).toBe("/");
    expect(destinoSeguro(null)).toBe("/");
  });

  it("não volta para o próprio login (evita laço)", () => {
    expect(destinoSeguro("/login")).toBe("/");
    expect(destinoSeguro("/redefinir-senha?token=x")).toBe("/");
  });
});

describe("rotaPublica", () => {
  it("libera só login, recuperação e a tela offline", () => {
    for (const r of ["/login", "/recuperar-senha", "/redefinir-senha", "/offline"]) expect(rotaPublica(r)).toBe(true);
  });

  it("todo o resto é privado", () => {
    for (const r of ["/", "/pdv", "/dashboard", "/usuarios", "/backup", "/clientes", "/loginx", "/login-falso/abc"]) {
      expect(rotaPublica(r)).toBe(false);
    }
  });
});

describe("tokens", () => {
  it("são aleatórios, longos e o hash não revela o token", () => {
    const a = gerarToken();
    const b = gerarToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 256 bits em base64url
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
    expect(hashToken(a)).toBe(hashToken(a));
  });
});
