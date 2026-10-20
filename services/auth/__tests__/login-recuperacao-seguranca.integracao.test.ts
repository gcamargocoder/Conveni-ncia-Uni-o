// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

/**
 * Login e recuperação de senha: contagem atômica de tentativas, IP canônico/confiável e ausência
 * de vazamento em respostas e logs. PostgreSQL REAL de teste (npm run test:integracao); nenhum
 * e-mail real é enviado (envio injetado ou fetch falso).
 */
const ambiente = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  cabecalhos: new Map<string, string>(),
  falharLimitador: false,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nome: string) => (ambiente.cookies.has(nome) ? { name: nome, value: ambiente.cookies.get(nome)! } : undefined),
    set: (nome: string, valor: string, opcoes: Record<string, unknown> = {}) => {
      if (valor === "" || opcoes.maxAge === 0) ambiente.cookies.delete(nome);
      else ambiente.cookies.set(nome, valor);
    },
  }),
  headers: async () => ({ get: (nome: string) => ambiente.cabecalhos.get(nome.toLowerCase()) ?? null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));

// Permite provocar um erro inesperado (com dados sensíveis na mensagem) dentro do limitador.
vi.mock("../limitador.store", async (original) => {
  const real = await original<typeof import("../limitador.store")>();
  const falha = () => Promise.reject(new Error("pg: senha_hash=$argon2id$SEGREDO token=TOKEN-SECRETO host=db.interno"));
  return {
    ...real,
    registrarFalha: (...a: Parameters<typeof real.registrarFalha>) => (ambiente.falharLimitador ? falha() : real.registrarFalha(...a)),
    reservarTentativa: (...a: Parameters<typeof real.reservarTentativa>) => (ambiente.falharLimitador ? falha() : real.reservarTentativa(...a)),
  };
});

import { prisma } from "@/services/prisma/client";
import { autenticar, redefinirSenha, solicitarRecuperacao } from "../auth.service";
import { loginAction, redefinirSenhaAction, solicitarRecuperacaoAction } from "@/lib/auth/sessao-actions";
import { gerarHashSenha } from "@/lib/auth/senha";
import { hashToken } from "@/lib/auth/token";
import type { MensagemEmail, ResultadoEnvioEmail } from "@/lib/email/enviar";

const SENHA = "Cafe-com-Leite-42";
const ENV_ORIGINAL = { ...process.env };
let enviados: MensagemEmail[] = [];
const enviarOk = async (m: MensagemEmail): Promise<ResultadoEnvioEmail> => (enviados.push(m), { enviado: true });

async function criarConta(email = "dona@loja.com") {
  return prisma.usuario.create({
    data: { email, nome: "Dona", papel: "admin", senha_hash: await gerarHashSenha(SENHA), senha_alterada_em: new Date() },
  });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "sessoes", "tokens_recuperacao", "limites_tentativa", "ativacoes_iniciais", "usuarios" RESTART IDENTITY CASCADE'
  );
  enviados = [];
  ambiente.cookies.clear();
  ambiente.cabecalhos.clear();
  ambiente.falharLimitador = false;
  ambiente.cabecalhos.set("x-real-ip", "203.0.113.50");
  process.env.APP_URL = "https://app.example.com";
  process.env.RESEND_API_KEY = "chave-falsa-de-teste";
  process.env.EMAIL_FROM = "Teste <teste@example.com>";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  process.env = ENV_ORIGINAL;
  await prisma.$disconnect();
});

const errada = (email: string, ip: string, i = 0) => autenticar({ email, senha: `errada-${i}-Zz9`, ip });

describe("login: contagem atômica", () => {
  it("rajada simultânea de senhas erradas na mesma conta: no máximo 5 são avaliadas, o resto é bloqueado", async () => {
    await criarConta();
    const r = await Promise.all(Array.from({ length: 40 }, (_, i) => errada("dona@loja.com", "10.0.0.1", i)));
    const avaliadas = r.filter((x) => !x.ok && x.motivo === "credenciais").length;
    const bloqueadas = r.filter((x) => !x.ok && x.motivo === "bloqueado").length;
    expect(avaliadas).toBeLessThanOrEqual(5); // antes da correção: as 40 eram avaliadas
    expect(avaliadas + bloqueadas).toBe(40);
  });

  it("durante o bloqueio nem a senha certa passa, e a resposta é igual para e-mail inexistente", async () => {
    await criarConta();
    for (let i = 0; i < 5; i++) await errada("dona@loja.com", "10.0.0.1", i);
    expect(await autenticar({ email: "dona@loja.com", senha: SENHA, ip: "10.0.0.1" })).toMatchObject({ ok: false, motivo: "bloqueado" });
    for (let i = 0; i < 5; i++) await errada("nao-existe@loja.com", "10.0.0.2", i);
    expect(await autenticar({ email: "nao-existe@loja.com", senha: SENHA, ip: "10.0.0.2" })).toMatchObject({ ok: false, motivo: "bloqueado" });
  });

  it("rajada de senhas erradas variando o e-mail a partir de um IP: o limite do IP (20) vale sob concorrência", async () => {
    const r = await Promise.all(Array.from({ length: 60 }, (_, i) => errada(`alvo${i}@loja.com`, "10.0.0.9", i)));
    expect(r.filter((x) => !x.ok && x.motivo === "credenciais").length).toBeLessThanOrEqual(20);
  });

  it.each([
    ["zeros à esquerda", "203.000.113.050"],
    ["IPv4 mapeado em IPv6", "::ffff:203.0.113.50"],
    ["porta", "203.0.113.50:4433"],
  ])("variações de formato do IP não ganham contador novo (%s)", async (_n, variante) => {
    const formas = ["203.0.113.50", variante];
    for (let i = 0; i < 20; i++) await errada(`alvo${i}@loja.com`, formas[i % 2], i);
    expect(await errada("outro@loja.com", "203.0.113.50", 99)).toMatchObject({ ok: false, motivo: "bloqueado" });
  });

  it("IPv6: trocar o sufixo dentro da mesma /64 não escapa do limite", async () => {
    for (let i = 0; i < 20; i++) await errada(`alvo${i}@loja.com`, `2001:db8:abcd:12:${i}::${i + 1}`, i);
    expect(await errada("outro@loja.com", "2001:db8:abcd:12::ffff", 99)).toMatchObject({ ok: false, motivo: "bloqueado" });
  });

  it("login legítimo continua funcionando e não consome o limite do IP (sucessos são devolvidos)", async () => {
    await criarConta();
    for (let i = 0; i < 30; i++) {
      expect((await autenticar({ email: "dona@loja.com", senha: SENHA, ip: "10.0.0.5" })).ok).toBe(true);
    }
    expect(await errada("dona@loja.com", "10.0.0.5", 1)).toMatchObject({ ok: false, motivo: "credenciais" });
  });

  it("sucesso zera o contador da conta (erros anteriores não acumulam)", async () => {
    await criarConta();
    for (let i = 0; i < 4; i++) await errada("dona@loja.com", "10.0.0.1", i);
    expect((await autenticar({ email: "dona@loja.com", senha: SENHA, ip: "10.0.0.1" })).ok).toBe(true);
    for (let i = 0; i < 4; i++) expect(await errada("dona@loja.com", "10.0.0.1", i)).toMatchObject({ motivo: "credenciais" });
  });
});

describe("recuperação de senha: contagem atômica e sem enumeração", () => {
  it("rajada de pedidos para a mesma conta: no máximo 3 e-mails por hora", async () => {
    await criarConta();
    const r = await Promise.all(
      Array.from({ length: 30 }, (_, i) => solicitarRecuperacao({ email: "dona@loja.com", ip: `198.51.100.${i + 1}` }, enviarOk))
    );
    await Promise.all(r.map((x) => x.envio));
    expect(enviados.length).toBeLessThanOrEqual(3); // antes da correção: os 30 enviavam
    expect(enviados.length).toBeGreaterThan(0);
  });

  it("rajada a partir de um IP, variando os e-mails: no máximo 5 pedidos por hora e IP", async () => {
    await criarConta();
    const r = await Promise.all(
      Array.from({ length: 30 }, (_, i) => solicitarRecuperacao({ email: i === 0 ? "dona@loja.com" : `x${i}@loja.com`, ip: "198.51.100.7" }, enviarOk))
    );
    await Promise.all(r.map((x) => x.envio));
    const contados = await prisma.limiteTentativa.findMany({ where: { chave: { startsWith: "rec:ip:" } } });
    expect(contados).toHaveLength(1); // um único contador para o IP
    expect(enviados.length).toBeLessThanOrEqual(1);
  });

  it("variações de formato do IP não dão pedidos extras", async () => {
    await criarConta();
    const formas = ["198.51.100.7", "198.051.100.007", "::ffff:198.51.100.7", "198.51.100.7:99", " 198.51.100.7"];
    for (let i = 0; i < 12; i++) await solicitarRecuperacao({ email: `x${i}@loja.com`, ip: formas[i % formas.length] }, enviarOk);
    expect(await prisma.limiteTentativa.count({ where: { chave: { startsWith: "rec:ip:" } } })).toBe(1);
    const { envio } = await solicitarRecuperacao({ email: "dona@loja.com", ip: "198.51.100.7" }, enviarOk);
    expect(envio).toBeNull(); // IP já no limite: nem a conta real recebe e-mail
  });

  it("a Server Action responde exatamente igual para e-mail existente, inexistente e limitado", async () => {
    await criarConta();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const a = await solicitarRecuperacaoAction({ email: "dona@loja.com" });
    const b = await solicitarRecuperacaoAction({ email: "nao-existe@loja.com" });
    for (let i = 0; i < 6; i++) await solicitarRecuperacaoAction({ email: "dona@loja.com" });
    const c = await solicitarRecuperacaoAction({ email: "dona@loja.com" }); // já limitado
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("redefinir com token: uso único sob concorrência e tentativas inválidas limitadas de forma atômica", async () => {
    const u = await criarConta();
    const token = "token-de-teste-com-bastante-entropia-0123456789";
    await prisma.tokenRecuperacao.create({ data: { usuario_id: u.id, token_hash: hashToken(token), expira_em: new Date(Date.now() + 600000) } });
    const r = await Promise.all(Array.from({ length: 6 }, () => redefinirSenha({ token, novaSenha: "Outra-Senha-Forte-77", ip: "198.51.100.20" })));
    expect(r.filter((x) => x.ok)).toHaveLength(1);

    const falsos = await Promise.all(Array.from({ length: 40 }, (_, i) => redefinirSenha({ token: `falso-${i}`, novaSenha: "Outra-Senha-Forte-77", ip: "198.51.100.21" })));
    expect(falsos.filter((x) => !x.ok && x.motivo === "token_invalido").length).toBeLessThanOrEqual(10);
  });

  it("fluxo legítimo completo: recupera a senha, a antiga morre e o login novo funciona", async () => {
    await criarConta();
    const { envio } = await solicitarRecuperacao({ email: "dona@loja.com", ip: "198.51.100.30" }, enviarOk);
    await envio;
    const token = /redefinir-senha\?token=([\w-]+)/.exec(enviados[0].texto)![1];
    expect(await redefinirSenha({ token, novaSenha: "Outra-Senha-Forte-77", ip: "198.51.100.30" })).toEqual({ ok: true });
    expect((await autenticar({ email: "dona@loja.com", senha: SENHA, ip: "10.0.0.1" })).ok).toBe(false);
    expect((await autenticar({ email: "dona@loja.com", senha: "Outra-Senha-Forte-77", ip: "10.0.0.1" })).ok).toBe(true);
  });
});

describe("IP confiável (cabeçalhos do proxy)", () => {
  it("o login usa x-real-ip; um x-forwarded-for forjado não muda o contador", async () => {
    await criarConta();
    ambiente.cabecalhos.set("x-real-ip", "203.0.113.77");
    for (let i = 0; i < 20; i++) {
      ambiente.cabecalhos.set("x-forwarded-for", `9.9.9.${i}, 203.0.113.77`); // primeiro item forjado a cada tentativa
      await loginAction({ email: `alvo${i}@loja.com`, senha: `errada-${i}-Zz9` });
    }
    ambiente.cabecalhos.set("x-forwarded-for", "8.8.8.8, 203.0.113.77");
    const r = await loginAction({ email: "dona@loja.com", senha: SENHA });
    expect(r.sucesso).toBe(false);
    expect(r.erro).toMatch(/Muitas tentativas/);
  });

  it("sem x-real-ip usa o ÚLTIMO item de x-forwarded-for (o anexado pelo proxy), nunca o primeiro", async () => {
    await criarConta();
    ambiente.cabecalhos.delete("x-real-ip");
    for (let i = 0; i < 20; i++) {
      ambiente.cabecalhos.set("x-forwarded-for", `9.9.9.${i}, 203.0.113.88`);
      await loginAction({ email: `alvo${i}@loja.com`, senha: `errada-${i}-Zz9` });
    }
    ambiente.cabecalhos.set("x-forwarded-for", "7.7.7.7, 203.0.113.88");
    expect((await loginAction({ email: "dona@loja.com", senha: SENHA })).erro).toMatch(/Muitas tentativas/);
  });
});

describe("falhas inesperadas não vazam dados", () => {
  const SEGREDOS = /SEGREDO|TOKEN-SECRETO|argon2id|senha_hash|db\.interno|Cafe-com-Leite|Outra-Senha/;

  it("loginAction, redefinirSenhaAction e solicitarRecuperacaoAction: resposta genérica e log só com o nome do erro", async () => {
    await criarConta();
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
    ambiente.falharLimitador = true;

    const login = await loginAction({ email: "dona@loja.com", senha: SENHA });
    const redef = await redefinirSenhaAction({ token: "TOKEN-SECRETO-XYZ", senha: "Outra-Senha-Forte-77", confirmacao: "Outra-Senha-Forte-77" });
    const recup = await solicitarRecuperacaoAction({ email: "dona@loja.com" });

    expect(login.sucesso).toBe(false);
    expect(redef.sucesso).toBe(false);
    for (const r of [login, redef, recup]) expect(JSON.stringify(r)).not.toMatch(SEGREDOS);
    expect(JSON.stringify(login) + JSON.stringify(redef)).not.toMatch(/E-mail ou senha incorretos/); // erro interno ≠ credencial errada
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toMatch(SEGREDOS);
    expect(logs.join("\n")).not.toContain("TOKEN-SECRETO-XYZ");
  });

  it("a recuperação responde igual mesmo quando falha por dentro (não vira oráculo de existência)", async () => {
    await criarConta();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const ok = await solicitarRecuperacaoAction({ email: "dona@loja.com" });
    ambiente.falharLimitador = true;
    const comFalha = await solicitarRecuperacaoAction({ email: "dona@loja.com" });
    const comFalhaInexistente = await solicitarRecuperacaoAction({ email: "nao-existe@loja.com" });
    expect(comFalha).toEqual(ok);
    expect(comFalhaInexistente).toEqual(ok);
  });
});
