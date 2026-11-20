import { describe, expect, it } from "vitest";
import { descreverEmailAusente, emailConfigurado, variaveisEmailAusentes } from "../enviar";

const completo = { RESEND_API_KEY: "re_chave_de_teste_123", EMAIL_FROM: "App <x@dominio.com.br>", APP_URL: "https://app.exemplo.com.br" };

describe("variaveisEmailAusentes", () => {
  it("em produção sem nenhuma variável: as três faltam", () => {
    expect(variaveisEmailAusentes({}, true)).toEqual(["RESEND_API_KEY", "EMAIL_FROM", "APP_URL"]);
  });
  it("tudo configurado: nada falta", () => {
    expect(variaveisEmailAusentes(completo, true)).toEqual([]);
  });
  it("detecta cada variável individualmente (inclusive APP_URL, que emailConfigurado não confere)", () => {
    expect(variaveisEmailAusentes({ ...completo, APP_URL: undefined }, true)).toEqual(["APP_URL"]);
    expect(variaveisEmailAusentes({ ...completo, EMAIL_FROM: undefined }, true)).toEqual(["EMAIL_FROM"]);
    expect(variaveisEmailAusentes({ ...completo, RESEND_API_KEY: undefined }, true)).toEqual(["RESEND_API_KEY"]);
  });
  it("valor vazio ou só espaços conta como ausente", () => {
    expect(variaveisEmailAusentes({ ...completo, RESEND_API_KEY: "   ", EMAIL_FROM: "" }, true)).toEqual(["RESEND_API_KEY", "EMAIL_FROM"]);
  });
  it("fora de produção APP_URL não é exigida (o link cai em localhost)", () => {
    expect(variaveisEmailAusentes({ RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.com" }, false)).toEqual([]);
  });
});

describe("descreverEmailAusente", () => {
  it("lista só o que falta, diz o que deixa de funcionar e não promete envio", () => {
    const t = descreverEmailAusente(["RESEND_API_KEY", "APP_URL"]);
    expect(t).toContain("RESEND_API_KEY, APP_URL");
    expect(t).not.toContain("EMAIL_FROM");
    expect(t).toMatch(/NÃO envia e-mails/);
    expect(t).toMatch(/login, os PINs e o restante do sistema não são afetados/);
  });
  it("nunca contém valores de variáveis", () => {
    expect(descreverEmailAusente(variaveisEmailAusentes({}, true))).not.toMatch(/re_|https?:/);
  });
});

describe("emailConfigurado (usada pelo envio)", () => {
  it("continua exigindo chave e remetente", () => {
    const antes = { ...process.env };
    try {
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_FROM;
      expect(emailConfigurado()).toBe(false);
      process.env.RESEND_API_KEY = "re_x";
      expect(emailConfigurado()).toBe(false);
      process.env.EMAIL_FROM = "a@b.com";
      expect(emailConfigurado()).toBe(true);
    } finally {
      process.env.RESEND_API_KEY = antes.RESEND_API_KEY;
      process.env.EMAIL_FROM = antes.EMAIL_FROM;
      if (antes.RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY;
      if (antes.EMAIL_FROM === undefined) delete process.env.EMAIL_FROM;
    }
  });
});
