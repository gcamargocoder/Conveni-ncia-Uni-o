// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

/**
 * Ativação inicial da conta principal (código de inicialização + link de e-mail de uso único).
 * PostgreSQL REAL de teste: npm run test:integracao. O envio de e-mail é sempre simulado AQUI
 * (injeção / fetch falso): nenhum e-mail real é enviado nestes testes.
 */
const ambiente = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  cabecalhos: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nome: string) => (ambiente.cookies.has(nome) ? { name: nome, value: ambiente.cookies.get(nome)! } : undefined),
    set: () => undefined,
  }),
  headers: async () => ({ get: (nome: string) => ambiente.cabecalhos.get(nome.toLowerCase()) ?? null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));

import { prisma } from "@/services/prisma/client";
import { autenticar, solicitarRecuperacao } from "../auth.service";
import {
  confirmarAtivacao,
  situacaoAtivacao,
  solicitarAtivacao,
  tokenAtivacaoValido,
} from "../ativacao.service";
import { confirmarAtivacaoAction, solicitarAtivacaoAction } from "@/lib/auth/ativacao-actions";
import { hashToken } from "@/lib/auth/token";
import { TOKEN_ATIVACAO_MS } from "@/lib/auth/constantes";
import type { MensagemEmail, ResultadoEnvioEmail } from "@/lib/email/enviar";

const CODIGO = "codigo-de-inicializacao-de-teste-0123456789";
const SENHA = "Cafe-com-Leite-42";
const IP = "203.0.113.50";
const MIN = 60 * 1000;

const ENV_ORIGINAL = { ...process.env };
let enviados: MensagemEmail[] = [];
const enviarOk = async (m: MensagemEmail): Promise<ResultadoEnvioEmail> => {
  enviados.push(m);
  return { enviado: true };
};

function configurar(opcoes: { codigo?: string | null; email?: boolean } = {}) {
  const codigo = opcoes.codigo === undefined ? CODIGO : opcoes.codigo;
  if (codigo === null) delete process.env.ATIVACAO_INICIAL_CODIGO;
  else process.env.ATIVACAO_INICIAL_CODIGO = codigo;
  if (opcoes.email === false) {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  } else {
    process.env.RESEND_API_KEY = "chave-falsa-de-teste";
    process.env.EMAIL_FROM = "Teste <teste@example.com>";
  }
  process.env.APP_URL = "https://app.example.com";
}

const pedido = (extra: Partial<Parameters<typeof solicitarAtivacao>[0]> = {}) => ({
  codigo: CODIGO,
  nome: "Dona da Loja",
  email: "Dona@Loja.com",
  senha: SENHA,
  ip: IP,
  ...extra,
});

function tokenDoEmail(m: MensagemEmail): string {
  const achou = /\/ativar-conta\?token=([\w-]+)/.exec(m.texto);
  if (!achou) throw new Error("e-mail sem link");
  return achou[1];
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "sessoes", "tokens_recuperacao", "limites_tentativa", "ativacoes_iniciais", "usuarios" RESTART IDENTITY CASCADE'
  );
  enviados = [];
  ambiente.cookies.clear();
  ambiente.cabecalhos.clear();
  ambiente.cabecalhos.set("x-real-ip", IP);
  configurar();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  process.env = ENV_ORIGINAL;
  await prisma.$disconnect();
});

const contarUsuarios = () => prisma.usuario.count();
const contarPedidos = () => prisma.ativacaoInicial.count();

describe("autorização de inicialização", () => {
  it("sem ATIVACAO_INICIAL_CODIGO o fluxo está desligado: nada é gravado nem enviado", async () => {
    configurar({ codigo: null });
    expect(await situacaoAtivacao()).toBe("desligada");
    expect(await solicitarAtivacao(pedido(), enviarOk)).toEqual({ ok: false, motivo: "indisponivel" });
    expect(enviados).toHaveLength(0);
    expect(await contarPedidos()).toBe(0);
    expect(await contarUsuarios()).toBe(0);
  });

  it("código configurado curto demais (< 24) conta como desligado, mesmo que o informado seja igual", async () => {
    configurar({ codigo: "curto123" });
    expect(await solicitarAtivacao(pedido({ codigo: "curto123" }), enviarOk)).toEqual({ ok: false, motivo: "indisponivel" });
    expect(await contarPedidos()).toBe(0);
  });

  it("código errado é recusado e nada é gravado nem enviado (e e-mail confirmado sozinho não concede nada)", async () => {
    const r = await solicitarAtivacao(pedido({ codigo: "palpite-errado" }), enviarOk);
    expect(r).toEqual({ ok: false, motivo: "codigo_invalido" });
    expect(enviados).toHaveLength(0);
    expect(await contarPedidos()).toBe(0);
    expect(await contarUsuarios()).toBe(0);
  });

  it("adivinhação do código é limitada: após 5 erros nem o código certo passa (bloqueado)", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await solicitarAtivacao(pedido({ codigo: `errado-${i}` }), enviarOk)).ok).toBe(false);
    }
    const r = await solicitarAtivacao(pedido(), enviarOk);
    expect(r).toMatchObject({ ok: false, motivo: "bloqueado" });
    expect(enviados).toHaveLength(0);
    expect(await contarUsuarios()).toBe(0);
  });
});

describe("e-mail real obrigatório (sem simular sucesso)", () => {
  it("e-mail não configurado: recusa, não grava pedido, não cria conta", async () => {
    configurar({ email: false });
    expect(await situacaoAtivacao()).toBe("email_nao_configurado");
    expect(await solicitarAtivacao(pedido(), enviarOk)).toEqual({ ok: false, motivo: "email_nao_configurado" });
    expect(enviados).toHaveLength(0);
    expect(await contarPedidos()).toBe(0);
    expect(await contarUsuarios()).toBe(0);
  });

  it("o provedor recusa o envio: o pedido é invalidado e a conta NÃO é liberada", async () => {
    const r = await solicitarAtivacao(pedido(), async () => ({ enviado: false, motivo: "falha_provedor" }));
    expect(r).toEqual({ ok: false, motivo: "falha_envio" });
    expect(await contarPedidos()).toBe(0); // pedido apagado: o link não existe mais
    expect(await contarUsuarios()).toBe(0);
  });

  it("pelas Server Actions + fetch falso da Resend: senha e token não aparecem no corpo além do link", async () => {
    const fetchFalso = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchFalso);
    const r = await solicitarAtivacaoAction({ codigo: CODIGO, nome: "Dona", email: "dona@loja.com", senha: SENHA, confirmacao: SENHA });
    expect(r).toEqual({ sucesso: true });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const corpo = String((fetchFalso.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(corpo).not.toContain(SENHA);
    expect(corpo).not.toContain(CODIGO);
    expect(corpo).toContain("https://app.example.com/ativar-conta?token=");
    expect(await contarUsuarios()).toBe(0);
  });

  it("a action recusa confirmação de senha diferente antes de qualquer envio", async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);
    const r = await solicitarAtivacaoAction({ codigo: CODIGO, nome: "Dona", email: "dona@loja.com", senha: SENHA, confirmacao: "outra" });
    expect(r.sucesso).toBe(false);
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

describe("pedido: validação e armazenamento", () => {
  it("senha fraca / e-mail inválido / nome curto são recusados sem gravar", async () => {
    expect(await solicitarAtivacao(pedido({ senha: "123" }), enviarOk)).toMatchObject({ ok: false, motivo: "dados_invalidos" });
    expect(await solicitarAtivacao(pedido({ email: "invalido" }), enviarOk)).toMatchObject({ ok: false, motivo: "dados_invalidos" });
    expect(await solicitarAtivacao(pedido({ nome: "A" }), enviarOk)).toMatchObject({ ok: false, motivo: "dados_invalidos" });
    expect(await contarPedidos()).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it("no banco ficam só o hash Argon2id da senha e o SHA-256 do token; o token só existe no e-mail", async () => {
    expect(await solicitarAtivacao(pedido(), enviarOk)).toEqual({ ok: true });
    const token = tokenDoEmail(enviados[0]);
    const [p] = await prisma.ativacaoInicial.findMany();
    expect(p.email).toBe("dona@loja.com");
    expect(p.senha_hash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(p)).not.toContain(SENHA);
    expect(JSON.stringify(p)).not.toContain(token);
    expect(p.token_hash).toBe(hashToken(token));
    expect(p.expira_em.getTime()).toBeGreaterThan(Date.now() + TOKEN_ATIVACAO_MS - MIN);
    expect(enviados[0].texto).not.toContain(SENHA);
    expect(await contarUsuarios()).toBe(0); // pedir não concede nada
  });

  it("um novo pedido invalida o link do anterior (um só pendente)", async () => {
    await solicitarAtivacao(pedido(), enviarOk);
    await solicitarAtivacao(pedido({ email: "outro@loja.com" }), enviarOk);
    const [t1, t2] = enviados.map(tokenDoEmail);
    expect(await tokenAtivacaoValido(t1)).toBe(false);
    expect(await tokenAtivacaoValido(t2)).toBe(true);
    expect((await confirmarAtivacao({ token: t1, ip: IP })).ok).toBe(false);
    expect(await contarUsuarios()).toBe(0);
  });
});

describe("confirmação pelo link", () => {
  it("fluxo completo: cria a conta principal (admin); o login funciona e a senha errada não", async () => {
    await solicitarAtivacao(pedido(), enviarOk);
    const token = tokenDoEmail(enviados[0]);

    expect(await tokenAtivacaoValido(token)).toBe(true); // abrir/validar não consome
    expect(await tokenAtivacaoValido(token)).toBe(true);
    expect(await contarUsuarios()).toBe(0);

    const r = await confirmarAtivacao({ token, ip: IP });
    expect(r).toEqual({ ok: true, email: "dona@loja.com" });

    const [u] = await prisma.usuario.findMany();
    expect(u).toMatchObject({ email: "dona@loja.com", nome: "Dona da Loja", papel: "admin", ativo: true });
    expect(u.senha_hash).toMatch(/^\$argon2id\$/);

    expect((await autenticar({ email: "dona@loja.com", senha: SENHA, ip: "10.0.0.1" })).ok).toBe(true);
    expect((await autenticar({ email: "dona@loja.com", senha: "errada-errada-1", ip: "10.0.0.1" })).ok).toBe(false);
    expect(await situacaoAtivacao()).toBe("encerrada");
  });

  it("token reutilizado é recusado e nada novo é criado", async () => {
    await solicitarAtivacao(pedido(), enviarOk);
    const token = tokenDoEmail(enviados[0]);
    expect((await confirmarAtivacao({ token, ip: IP })).ok).toBe(true);
    const de_novo = await confirmarAtivacao({ token, ip: IP });
    expect(de_novo).toMatchObject({ ok: false });
    expect(await contarUsuarios()).toBe(1);
  });

  it("token expirado é recusado e a conta não é criada", async () => {
    await solicitarAtivacao(pedido(), enviarOk);
    const token = tokenDoEmail(enviados[0]);
    const depois = new Date(Date.now() + TOKEN_ATIVACAO_MS + MIN);
    expect(await tokenAtivacaoValido(token, depois)).toBe(false);
    expect(await confirmarAtivacao({ token, ip: IP }, depois)).toEqual({ ok: false, motivo: "token_invalido" });
    expect(await contarUsuarios()).toBe(0);
  });

  it("token inventado é recusado; tentativas em excesso bloqueiam o IP", async () => {
    await solicitarAtivacao(pedido(), enviarOk);
    for (let i = 0; i < 10; i++) {
      expect(await confirmarAtivacao({ token: `inventado-${i}`, ip: IP })).toEqual({ ok: false, motivo: "token_invalido" });
    }
    const real = tokenDoEmail(enviados[0]);
    expect(await confirmarAtivacao({ token: real, ip: IP })).toMatchObject({ ok: false, motivo: "bloqueado" });
    expect(await contarUsuarios()).toBe(0);
  });

  it("se o código de inicialização é removido do servidor, links pendentes deixam de valer", async () => {
    await solicitarAtivacao(pedido(), enviarOk);
    const token = tokenDoEmail(enviados[0]);
    configurar({ codigo: null });
    expect(await tokenAtivacaoValido(token)).toBe(false);
    expect((await confirmarAtivacao({ token, ip: IP })).ok).toBe(false);
    expect(await contarUsuarios()).toBe(0);
  });

  it("pela Server Action: confirma uma vez; a segunda chamada falha", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await solicitarAtivacaoAction({ codigo: CODIGO, nome: "Dona", email: "dona@loja.com", senha: SENHA, confirmacao: SENHA });
    const corpo = String((vi.mocked(fetch).mock.calls[0] as unknown as [string, { body: string }])[1].body);
    const token = /ativar-conta\?token=([\w-]+)/.exec(corpo)![1];
    expect(await confirmarAtivacaoAction(token)).toEqual({ sucesso: true });
    expect((await confirmarAtivacaoAction(token)).sucesso).toBe(false);
    expect(await contarUsuarios()).toBe(1);
  });
});

describe("apenas uma conta principal (atomicidade)", () => {
  it("confirmações simultâneas do mesmo token: exatamente uma vence", async () => {
    await solicitarAtivacao(pedido(), enviarOk);
    const token = tokenDoEmail(enviados[0]);
    const resultados = await Promise.all(Array.from({ length: 8 }, () => confirmarAtivacao({ token, ip: IP })));
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(await contarUsuarios()).toBe(1);
  });

  it("dois pedidos pendentes diferentes confirmados ao mesmo tempo: só uma conta nasce", async () => {
    // simula uma corrida em que dois pedidos chegaram a existir como pendentes
    const tokens = ["token-corrida-a-0123456789", "token-corrida-b-0123456789"];
    for (const [i, t] of tokens.entries()) {
      await prisma.ativacaoInicial.create({
        data: {
          email: `conta${i}@loja.com`,
          nome: `Conta ${i}`,
          senha_hash: "$argon2id$hash-falso",
          token_hash: hashToken(t),
          expira_em: new Date(Date.now() + TOKEN_ATIVACAO_MS),
        },
      });
    }
    const resultados = await Promise.all(tokens.map((t) => confirmarAtivacao({ token: t, ip: IP })));
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.find((r) => !r.ok)).toMatchObject({ ok: false, motivo: "encerrada" });
    expect(await contarUsuarios()).toBe(1);
    // o fluxo se encerra: nenhum pedido pendente sobra
    expect(await prisma.ativacaoInicial.count({ where: { usado_em: null } })).toBe(0);
  });

  it("depois da conta principal, qualquer segundo cadastro é recusado", async () => {
    await solicitarAtivacao(pedido(), enviarOk);
    await confirmarAtivacao({ token: tokenDoEmail(enviados[0]), ip: IP });
    enviados = [];

    expect(await solicitarAtivacao(pedido({ email: "segunda@loja.com" }), enviarOk)).toEqual({ ok: false, motivo: "indisponivel" });
    expect((await solicitarAtivacaoAction({ codigo: CODIGO, nome: "Outra", email: "segunda@loja.com", senha: SENHA, confirmacao: SENHA })).sucesso).toBe(false);
    expect(enviados).toHaveLength(0);
    expect(await contarUsuarios()).toBe(1);
  });

  it("pedido pendente criado antes não ativa uma segunda conta se já existe uma (ex.: criada pelo script)", async () => {
    await solicitarAtivacao(pedido({ email: "pendente@loja.com" }), enviarOk);
    const token = tokenDoEmail(enviados[0]);
    await prisma.usuario.create({ data: { email: "script@loja.com", nome: "Via script", senha_hash: "$argon2id$x", papel: "admin" } });
    expect(await confirmarAtivacao({ token, ip: IP })).toEqual({ ok: false, motivo: "encerrada" });
    expect(await contarUsuarios()).toBe(1);
  });
});

describe("regressões: login e recuperação de senha seguem funcionando", () => {
  it("conta ativada pelo fluxo recupera a senha pelo mecanismo existente", async () => {
    await solicitarAtivacao(pedido(), enviarOk);
    await confirmarAtivacao({ token: tokenDoEmail(enviados[0]), ip: IP });
    enviados = [];

    const { envio } = await solicitarRecuperacao({ email: "dona@loja.com", ip: "198.51.100.1" }, enviarOk);
    await envio;
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toContain("/redefinir-senha?token=");
    expect(await prisma.tokenRecuperacao.count()).toBe(1);
  });
});
