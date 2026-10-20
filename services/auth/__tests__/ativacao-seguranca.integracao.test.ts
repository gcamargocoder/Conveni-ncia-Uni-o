// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";

/**
 * Revisão de segurança da ativação inicial: cada teste abaixo cobre uma falha comprovada ou
 * uma garantia verificada. PostgreSQL REAL de teste (npm run test:integracao); nenhum e-mail real.
 */
const ambiente = vi.hoisted(() => ({ cabecalhos: new Map<string, string>(), falharLimitador: false }));

// Permite provocar um erro inesperado (com dados sensíveis na mensagem) no meio do fluxo.
vi.mock("../limitador.store", async (original) => {
  const real = await original<typeof import("../limitador.store")>();
  return {
    ...real,
    registrarFalha: (...args: Parameters<typeof real.registrarFalha>) =>
      ambiente.falharLimitador
        ? Promise.reject(new Error("falha com senha_hash=SEGREDO-NO-ERRO e codigo=codigo-de-inicializacao-de-teste-0123456789"))
        : real.registrarFalha(...args),
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
  headers: async () => ({ get: (nome: string) => ambiente.cabecalhos.get(nome.toLowerCase()) ?? null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));

import { prisma } from "@/services/prisma/client";
import { redefinirSenha, solicitarRecuperacao } from "../auth.service";
import { confirmarAtivacao, situacaoAtivacao, solicitarAtivacao, tokenAtivacaoValido } from "../ativacao.service";
import { confirmarAtivacaoAction, solicitarAtivacaoAction } from "@/lib/auth/ativacao-actions";
import type { MensagemEmail, ResultadoEnvioEmail } from "@/lib/email/enviar";

const CODIGO = "codigo-de-inicializacao-de-teste-0123456789";
const SENHA = "Cafe-com-Leite-42";
const ENV_ORIGINAL = { ...process.env };

let enviados: MensagemEmail[] = [];
const enviarOk = async (m: MensagemEmail): Promise<ResultadoEnvioEmail> => {
  enviados.push(m);
  return { enviado: true };
};
const tokenDoEmail = (m: MensagemEmail) => /\/ativar-conta\?token=([\w-]+)/.exec(m.texto)![1];

const pedido = (extra: Partial<Parameters<typeof solicitarAtivacao>[0]> = {}) => ({
  codigo: CODIGO,
  nome: "Dona da Loja",
  email: "dona@loja.com",
  senha: SENHA,
  ip: "203.0.113.50",
  ...extra,
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "sessoes", "tokens_recuperacao", "limites_tentativa", "ativacoes_iniciais", "usuarios" RESTART IDENTITY CASCADE'
  );
  enviados = [];
  ambiente.falharLimitador = false;
  ambiente.cabecalhos.clear();
  ambiente.cabecalhos.set("x-real-ip", "203.0.113.50");
  process.env.ATIVACAO_INICIAL_CODIGO = CODIGO;
  process.env.RESEND_API_KEY = "chave-falsa-de-teste";
  process.env.EMAIL_FROM = "Teste <teste@example.com>";
  process.env.APP_URL = "https://app.example.com";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  process.env = ENV_ORIGINAL;
  await prisma.$disconnect();
});

describe("limite de tentativas do código de inicialização", () => {
  it("é atômico: uma rajada simultânea de palpites não passa do limite", async () => {
    const spy = vi.fn();
    const resultados = await Promise.all(
      Array.from({ length: 40 }, (_, i) => solicitarAtivacao(pedido({ codigo: `palpite-${i}` }), async (m) => (spy(m), { enviado: true })))
    );
    const avaliados = resultados.filter((r) => !r.ok && r.motivo === "codigo_invalido").length;
    const barrados = resultados.filter((r) => !r.ok && r.motivo === "bloqueado").length;
    expect(avaliados).toBeLessThanOrEqual(5); // antes da correção: os 40 eram avaliados
    expect(avaliados + barrados).toBe(40);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ["IPv4 com zeros à esquerda", "203.000.113.050"],
    ["IPv4 mapeado em IPv6", "::ffff:203.0.113.50"],
    ["IPv4 com porta", "203.0.113.50:51234"],
    ["IPv4 com espaços", "  203.0.113.50 "],
  ])("variações de formato do mesmo IP caem no mesmo contador (%s)", async (_nome, variante) => {
    for (let i = 0; i < 4; i++) await solicitarAtivacao(pedido({ codigo: `errado-${i}`, ip: "203.0.113.50" }), enviarOk);
    // a 5ª tentativa, com o IP escrito de outro jeito, dispara o bloqueio do MESMO contador
    const r = await solicitarAtivacao(pedido({ codigo: "errado-5", ip: variante }), enviarOk);
    expect(r.ok).toBe(false);
    const seguinte = await solicitarAtivacao(pedido({ ip: "203.0.113.50" }), enviarOk);
    expect(seguinte).toMatchObject({ ok: false, motivo: "bloqueado" });
    expect(enviados).toHaveLength(0);
  });

  it("IPv6 de uma mesma rede /64 compartilha o contador (rotação de sufixo não contorna)", async () => {
    for (let i = 0; i < 4; i++) {
      await solicitarAtivacao(pedido({ codigo: `errado-${i}`, ip: `2001:db8:abcd:12:${i}::${i + 1}` }), enviarOk);
    }
    await solicitarAtivacao(pedido({ codigo: "errado-5", ip: "2001:DB8:ABCD:12:ffff:ffff:ffff:ffff" }), enviarOk);
    const r = await solicitarAtivacao(pedido({ ip: "2001:db8:abcd:12::99" }), enviarOk);
    expect(r).toMatchObject({ ok: false, motivo: "bloqueado" });
  });

  it("código correto zera o contador do IP (não acumula erros antigos)", async () => {
    for (let i = 0; i < 3; i++) await solicitarAtivacao(pedido({ codigo: `errado-${i}` }), enviarOk);
    expect(await solicitarAtivacao(pedido(), enviarOk)).toEqual({ ok: true });
    expect(await prisma.limiteTentativa.count({ where: { chave: { startsWith: "ativ:codigo:" } } })).toBe(0);
  });
});

describe("dados sensíveis: respostas e logs", () => {
  it("erro inesperado vira mensagem genérica; nada sensível vai para a resposta nem para o log", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
    ambiente.falharLimitador = true;

    const r1 = await solicitarAtivacaoAction({ codigo: CODIGO, nome: "Dona", email: "dona@loja.com", senha: SENHA, confirmacao: SENHA });
    const r2 = await confirmarAtivacaoAction("token-qualquer");
    for (const r of [r1, r2]) {
      expect(r.sucesso).toBe(false);
      expect(JSON.stringify(r)).not.toMatch(/SEGREDO|senha_hash|codigo-de-inicializacao/);
    }
    expect(logs.join("\n")).not.toMatch(/SEGREDO|senha_hash|codigo-de-inicializacao|token-qualquer/);
  });

  it("falha do provedor de e-mail: o log tem só o status, nunca link, token, senha ou código", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.map(String).join(" ")));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("recusado", { status: 422 })));
    const r = await solicitarAtivacaoAction({ codigo: CODIGO, nome: "Dona", email: "dona@loja.com", senha: SENHA, confirmacao: SENHA });
    expect(r.sucesso).toBe(false);
    expect(logs.join("\n")).not.toMatch(/ativar-conta|token=|Cafe-com-Leite|codigo-de-inicializacao/);
  });
});

describe("minimização de dados: hashes de senha de pedidos não concluídos", () => {
  it("pedido cujo e-mail não saiu é APAGADO (não fica hash de senha para trás)", async () => {
    await solicitarAtivacao(pedido(), async () => ({ enviado: false, motivo: "falha_provedor" }));
    expect(await prisma.ativacaoInicial.count()).toBe(0);
  });

  it("pedido substituído por um novo é apagado", async () => {
    await solicitarAtivacao(pedido({ email: "a@loja.com" }), enviarOk);
    await solicitarAtivacao(pedido({ email: "b@loja.com" }), enviarOk);
    const restantes = await prisma.ativacaoInicial.findMany();
    expect(restantes.map((p) => p.email)).toEqual(["b@loja.com"]);
  });

  it("ao ativar a conta, nenhum pedido (nem hash duplicado) permanece na tabela", async () => {
    await solicitarAtivacao(pedido(), enviarOk);
    expect((await confirmarAtivacao({ token: tokenDoEmail(enviados[0]), ip: "203.0.113.50" })).ok).toBe(true);
    expect(await prisma.ativacaoInicial.count()).toBe(0);
    expect(await prisma.usuario.count()).toBe(1);
  });
});

describe("encerramento: o código inicial deixa de importar e a recuperação não reabre o cadastro", () => {
  async function ativar() {
    await solicitarAtivacao(pedido(), enviarOk);
    await confirmarAtivacao({ token: tokenDoEmail(enviados[0]), ip: "203.0.113.50" });
    enviados = [];
  }

  it("com o código AINDA configurado, depois da ativação ele não abre mais nada", async () => {
    await ativar();
    expect(await situacaoAtivacao()).toBe("encerrada");
    expect(await solicitarAtivacao(pedido({ email: "outra@loja.com" }), enviarOk)).toEqual({ ok: false, motivo: "indisponivel" });
    expect(await prisma.ativacaoInicial.count()).toBe(0);
    expect(await prisma.usuario.count()).toBe(1);
  });

  it("sem o código configurado, a conta ativada continua entrando e o fluxo continua fechado", async () => {
    await ativar();
    delete process.env.ATIVACAO_INICIAL_CODIGO;
    expect(await situacaoAtivacao()).toBe("encerrada");
    expect(await prisma.usuario.count({ where: { ativo: true } })).toBe(1);
  });

  it("recuperação de senha completa não reabre a configuração inicial", async () => {
    await ativar();
    const { envio } = await solicitarRecuperacao({ email: "dona@loja.com", ip: "198.51.100.7" }, enviarOk);
    await envio;
    const token = /redefinir-senha\?token=([\w-]+)/.exec(enviados[0].texto)![1];
    expect(await redefinirSenha({ token, novaSenha: "Outra-Senha-Forte-77", ip: "198.51.100.7" })).toEqual({ ok: true });

    expect(await situacaoAtivacao()).toBe("encerrada");
    expect(await solicitarAtivacao(pedido({ email: "intruso@loja.com" }), enviarOk)).toEqual({ ok: false, motivo: "indisponivel" });
    expect(await prisma.usuario.count()).toBe(1);
  });

  it("desativar a única conta não reabre o cadastro (a linha continua existindo)", async () => {
    await ativar();
    await prisma.usuario.updateMany({ data: { ativo: false } });
    expect(await situacaoAtivacao()).toBe("encerrada");
    expect(await solicitarAtivacao(pedido({ email: "intruso@loja.com" }), enviarOk)).toEqual({ ok: false, motivo: "indisponivel" });
  });
});

describe("conta criada por outro caminho (script) com pedido pendente", () => {
  async function pendenteEContaPorScript() {
    await solicitarAtivacao(pedido({ email: "pendente@loja.com" }), enviarOk);
    const token = tokenDoEmail(enviados[0]);
    await prisma.usuario.create({ data: { email: "script@loja.com", nome: "Via script", senha_hash: "$argon2id$x", papel: "admin" } });
    return token;
  }

  it("confirmar o link antigo é recusado e o pedido (com o hash da senha) é apagado", async () => {
    const token = await pendenteEContaPorScript();
    expect(await confirmarAtivacao({ token, ip: "203.0.113.50" })).toEqual({ ok: false, motivo: "encerrada" });
    expect(await prisma.ativacaoInicial.count()).toBe(0);
    expect(await prisma.usuario.count()).toBe(1);
  });

  it("apenas abrir /configurar-conta ou /ativar-conta (situação/validação) já descarta o pedido", async () => {
    const token = await pendenteEContaPorScript();
    expect(await tokenAtivacaoValido(token)).toBe(false);
    expect(await prisma.ativacaoInicial.count()).toBe(0);
    await prisma.ativacaoInicial.create({ data: { email: "x@loja.com", nome: "X", senha_hash: "$argon2id$x", token_hash: "h", expira_em: new Date(Date.now() + 60000) } });
    expect(await situacaoAtivacao()).toBe("encerrada");
    expect(await prisma.ativacaoInicial.count()).toBe(0);
  });

  it("remover o código de inicialização depois da ativação não reabre nada", async () => {
    await pendenteEContaPorScript();
    delete process.env.ATIVACAO_INICIAL_CODIGO;
    expect(await situacaoAtivacao()).toBe("encerrada");
    process.env.ATIVACAO_INICIAL_CODIGO = CODIGO;
    expect(await situacaoAtivacao()).toBe("encerrada");
  });
});

describe("conta única também no PostgreSQL (gatilho usuarios_conta_unica)", () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe("ALTER TABLE usuarios ENABLE TRIGGER usuarios_conta_unica");
  });
  afterAll(async () => {
    await prisma.$executeRawUnsafe("ALTER TABLE usuarios DISABLE TRIGGER usuarios_conta_unica");
  });

  const linha = (email: string) => ({ email, nome: "Conta", senha_hash: "$argon2id$x", papel: "admin" });

  it("a primeira inserção passa; SQL direto de uma segunda é recusado", async () => {
    await prisma.usuario.create({ data: linha("a@loja.com") });
    await expect(
      prisma.$executeRawUnsafe(`INSERT INTO usuarios (email, nome, senha_hash, papel) VALUES ('b@loja.com','B','x','operador')`)
    ).rejects.toThrow(/conta única/i);
    expect(await prisma.usuario.count()).toBe(1);
  });

  it("inserção em lote de duas contas numa tabela vazia é recusada por inteiro", async () => {
    await expect(prisma.usuario.createMany({ data: [linha("a@loja.com"), linha("b@loja.com")] })).rejects.toThrow(/conta única/i);
    expect(await prisma.usuario.count()).toBe(0);
  });

  it("inserções diretas simultâneas: exatamente uma vence", async () => {
    const resultados = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => prisma.usuario.create({ data: linha(`c${i}@loja.com`) }))
    );
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.usuario.count()).toBe(1);
  });

  it("não impede UPDATE (recuperação/desativação) nem o fluxo normal de ativação", async () => {
    await solicitarAtivacao(pedido(), enviarOk);
    expect((await confirmarAtivacao({ token: tokenDoEmail(enviados[0]), ip: "203.0.113.50" })).ok).toBe(true);
    await prisma.usuario.updateMany({ data: { ativo: false } });
    await prisma.usuario.updateMany({ data: { ativo: true, nome: "Renomeada" } });
    expect(await prisma.usuario.count()).toBe(1);
  });
});
