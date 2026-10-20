import { describe, it, expect, vi } from "vitest";
import {
  dominioDoRemetente,
  resumo,
  verificarConfiguracaoProducao,
  verificarDnsDoRemetente,
  verificarDominioNaResend,
} from "../verificar-producao";

const SEGREDOS = {
  DATABASE_URL: "postgresql://postgres:SENHA-SECRETA-DB@containers-us-west.railway.app:5432/railway",
  APP_URL: "https://conveniencia.up.railway.app",
  RESEND_API_KEY: "re_ChaveSecretaDeTeste1234567890",
  EMAIL_FROM: "Conveniência União <nao-responder@loja.com.br>",
  ATIVACAO_INICIAL_CODIGO: "Zq8-vT3mKp9xLw2RnB6cHd4Y-eJ7uFs1",
};
const achar = (a: ReturnType<typeof verificarConfiguracaoProducao>, v: string) => a.find((x) => x.variavel === v)!;

describe("verificarConfiguracaoProducao", () => {
  it("configuração correta: nenhum erro e nenhum valor nos achados (nada de segredo na saída)", () => {
    const a = verificarConfiguracaoProducao({ ...SEGREDOS });
    expect(resumo(a)).toEqual({ erros: 0, avisos: 0 });
    const saida = JSON.stringify(a);
    for (const v of Object.values(SEGREDOS)) expect(saida).not.toContain(v);
    expect(saida).not.toContain("SENHA-SECRETA-DB");
    expect(saida).not.toContain("ChaveSecretaDeTeste");
  });

  it("variáveis obrigatórias ausentes são erro", () => {
    const a = verificarConfiguracaoProducao({});
    for (const v of ["DATABASE_URL", "APP_URL", "RESEND_API_KEY", "EMAIL_FROM"]) expect(achar(a, v).nivel, v).toBe("erro");
  });

  it.each([
    ["http://app.up.railway.app", "http"],
    ["https://app.up.railway.app/", "barra final"],
    ["https://app.up.railway.app/login", "caminho"],
    ["https://localhost:3000", "localhost"],
    ["isto-nao-e-url", "inválida"],
  ])("APP_URL %s é recusada (%s)", (valor) => {
    expect(achar(verificarConfiguracaoProducao({ ...SEGREDOS, APP_URL: valor }), "APP_URL").nivel).toBe("erro");
  });

  it("DATABASE_URL de teste ou localhost é erro", () => {
    expect(achar(verificarConfiguracaoProducao({ ...SEGREDOS, DATABASE_URL: "postgresql://u:p@localhost:5432/app" }), "DATABASE_URL").nivel).toBe("erro");
    expect(achar(verificarConfiguracaoProducao({ ...SEGREDOS, DATABASE_URL: "postgresql://u:p@host.railway.app:5432/conveniencia_test" }), "DATABASE_URL").nivel).toBe("erro");
  });

  it("ADMIN_SENHA e TEST_DATABASE_URL presentes são erro", () => {
    const a = verificarConfiguracaoProducao({ ...SEGREDOS, ADMIN_SENHA: "x", TEST_DATABASE_URL: "y" });
    expect(achar(a, "ADMIN_SENHA").nivel).toBe("erro");
    expect(achar(a, "TEST_DATABASE_URL").nivel).toBe("erro");
  });

  it("código de inicialização: curto e previsível são erro; ausente é só aviso (fluxo desligado)", () => {
    expect(achar(verificarConfiguracaoProducao({ ...SEGREDOS, ATIVACAO_INICIAL_CODIGO: "curto" }), "ATIVACAO_INICIAL_CODIGO").nivel).toBe("erro");
    expect(achar(verificarConfiguracaoProducao({ ...SEGREDOS, ATIVACAO_INICIAL_CODIGO: "a".repeat(40) }), "ATIVACAO_INICIAL_CODIGO").nivel).toBe("erro");
    expect(achar(verificarConfiguracaoProducao({ ...SEGREDOS, ATIVACAO_INICIAL_CODIGO: "0123456789012345678901234567" }), "ATIVACAO_INICIAL_CODIGO").nivel).toBe("erro");
    const { ATIVACAO_INICIAL_CODIGO: _omitida, ...semCodigo } = SEGREDOS;
    expect(achar(verificarConfiguracaoProducao(semCodigo), "ATIVACAO_INICIAL_CODIGO").nivel).toBe("aviso");
  });

  it("remetente: formatos aceitos, domínio de exemplo recusado, resend.dev avisa", () => {
    expect(dominioDoRemetente("Loja <a@Loja.com.br>")).toBe("loja.com.br");
    expect(dominioDoRemetente("a@loja.com.br")).toBe("loja.com.br");
    expect(dominioDoRemetente("sem-arroba")).toBeNull();
    expect(achar(verificarConfiguracaoProducao({ ...SEGREDOS, EMAIL_FROM: "x@example.com" }), "EMAIL_FROM").nivel).toBe("erro");
    expect(achar(verificarConfiguracaoProducao({ ...SEGREDOS, EMAIL_FROM: "x@resend.dev" }), "EMAIL_FROM").nivel).toBe("aviso");
    expect(achar(verificarConfiguracaoProducao({ ...SEGREDOS, EMAIL_FROM: "sem-arroba" }), "EMAIL_FROM").nivel).toBe("erro");
  });

  it("NODE_ENV cadastrada no serviço gera aviso (quebra o build por pular devDependencies); ausente é o correto", () => {
    expect(achar(verificarConfiguracaoProducao({ ...SEGREDOS, NODE_ENV: "production" }), "NODE_ENV").nivel).toBe("aviso");
    expect(verificarConfiguracaoProducao({ ...SEGREDOS }).some((x) => x.variavel === "NODE_ENV")).toBe(false);
  });

  it("horas offline fora do intervalo é erro", () => {
    expect(achar(verificarConfiguracaoProducao({ ...SEGREDOS, NEXT_PUBLIC_SESSAO_OFFLINE_HORAS: "9999" }), "NEXT_PUBLIC_SESSAO_OFFLINE_HORAS").nivel).toBe("erro");
  });
});

describe("verificações opcionais (sem enviar e-mail)", () => {
  const env = { RESEND_API_KEY: SEGREDOS.RESEND_API_KEY, EMAIL_FROM: SEGREDOS.EMAIL_FROM };
  const resposta = (status: number, corpo: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;

  it("Resend: domínio verificado → ok; pendente → erro; ausente → erro; só consulta GET /domains", async () => {
    const f = resposta(200, { data: [{ name: "loja.com.br", status: "verified" }] });
    expect((await verificarDominioNaResend(env, f)).nivel).toBe("ok");
    const chamada = vi.mocked(f).mock.calls[0] as unknown as [string, { method: string }];
    expect(chamada[0]).toBe("https://api.resend.com/domains");
    expect(chamada[1].method).toBe("GET");
    expect((await verificarDominioNaResend(env, resposta(200, { data: [{ name: "loja.com.br", status: "pending" }] }))).nivel).toBe("erro");
    expect((await verificarDominioNaResend(env, resposta(200, { data: [] }))).nivel).toBe("erro");
  });

  it("Resend: 401/403 e falha de rede são aviso (não prova que o envio falha) e a chave não aparece", async () => {
    const r401 = await verificarDominioNaResend(env, resposta(401));
    expect(r401.nivel).toBe("aviso");
    const rede = await verificarDominioNaResend(env, vi.fn(async () => { throw new TypeError("rede"); }) as unknown as typeof fetch);
    expect(rede.nivel).toBe("aviso");
    expect(JSON.stringify([r401, rede])).not.toContain("ChaveSecretaDeTeste");
  });

  it("DNS: DKIM publicado → ok; ausente → aviso", async () => {
    expect((await verificarDnsDoRemetente(env, async () => [["p=MIGfMA0GCSq"]])).nivel).toBe("ok");
    expect((await verificarDnsDoRemetente(env, async () => { throw new Error("ENOTFOUND"); })).nivel).toBe("aviso");
  });
});
