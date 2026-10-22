// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

/**
 * Configuração inicial do proprietário contra um PostgreSQL REAL de teste (npm run test:integracao).
 * Prova que a trava (advisory lock) faz só UMA de várias chamadas simultâneas vencer.
 */
const ambiente = vi.hoisted(() => ({ cookies: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nome: string) => (ambiente.cookies.has(nome) ? { name: nome, value: ambiente.cookies.get(nome)! } : undefined),
    set: (nome: string, valor: string) => ambiente.cookies.set(nome, valor),
  }),
  headers: async () => ({ get: (nome: string) => (nome.toLowerCase() === "x-real-ip" ? "203.0.113.7" : null) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));

import { prisma } from "@/services/prisma/client";
import { autenticar } from "@/services/auth/auth.service";
import { criarUsuarioDeTeste } from "@/services/auth/__tests__/fixtures-usuarios";
import { COOKIE_SESSAO } from "@/lib/auth/constantes";
import { configurarProprietarioInicialAction } from "@/lib/auth/funcionarios-actions";
import { verificarPin } from "@/lib/auth/pin";

const SENHA = "Cafe-com-Leite-42";

async function entrarComo(email: string, papel: "admin" | "operador") {
  await criarUsuarioDeTeste({ nome: `Usuário ${email}`, email, senha: SENHA, papel });
  const r = await autenticar({ email, senha: SENHA, ip: "10.0.0.1" });
  if (!r.ok) throw new Error("login de teste falhou");
  ambiente.cookies.set(COOKIE_SESSAO, r.token);
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "sessoes", "tokens_recuperacao", "limites_tentativa", "usuarios", "funcionarios", "tentativas_pin" RESTART IDENTITY CASCADE'
  );
  ambiente.cookies.clear();
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "sessoes", "usuarios", "funcionarios", "tentativas_pin" RESTART IDENTITY CASCADE');
  await prisma.$disconnect();
});

describe("configuração inicial do proprietário (banco real)", () => {
  it("duas chamadas simultâneas: só uma cria; o estado final tem exatamente um proprietário", async () => {
    await entrarComo("adm@loja.com", "admin");

    const [a, b] = await Promise.all([
      configurarProprietarioInicialAction({ nome: "Dono A", pin: "1111", confirmacaoPin: "1111" }),
      configurarProprietarioInicialAction({ nome: "Dono B", pin: "2222", confirmacaoPin: "2222" }),
    ]);

    expect([a.sucesso, b.sucesso].filter(Boolean)).toHaveLength(1);
    const perdedora = a.sucesso ? b : a;
    expect(perdedora.erro).toMatch(/já foi configurado/);

    const donos = await prisma.funcionario.findMany({ where: { cargo: "proprietario", deleted_at: null } });
    expect(donos).toHaveLength(1);
    expect(await prisma.funcionario.count()).toBe(1);
    expect(donos[0].pin_hash).not.toMatch(/^\d{4}$/);
    expect(await verificarPin(donos[0].nome === "Dono A" ? "1111" : "2222", donos[0].pin_hash)).toBe(true);
  });

  it("rajada de 8 chamadas simultâneas: continua exatamente um proprietário", async () => {
    await entrarComo("adm@loja.com", "admin");

    const resultados = await Promise.all(
      Array.from({ length: 8 }, (_, i) => {
        const pin = String(1000 + i);
        return configurarProprietarioInicialAction({ nome: `Dono ${i}`, pin, confirmacaoPin: pin });
      })
    );

    expect(resultados.filter((r) => r.sucesso)).toHaveLength(1);
    expect(await prisma.funcionario.count({ where: { cargo: "proprietario", deleted_at: null } })).toBe(1);
    expect(await prisma.funcionario.count()).toBe(1);
  });

  it("depois de configurado, uma nova tentativa é recusada e nada muda", async () => {
    await entrarComo("adm@loja.com", "admin");
    expect((await configurarProprietarioInicialAction({ nome: "Dono", pin: "1234", confirmacaoPin: "1234" })).sucesso).toBe(true);
    const antes = await prisma.funcionario.findFirstOrThrow();

    const r = await configurarProprietarioInicialAction({ nome: "Intruso", pin: "9999", confirmacaoPin: "9999" });
    expect(r.sucesso).toBe(false);

    const depois = await prisma.funcionario.findMany();
    expect(depois).toHaveLength(1);
    expect(depois[0].pin_hash).toBe(antes.pin_hash);
  });

  it("usuário comum (operador) não configura o proprietário", async () => {
    await entrarComo("op@loja.com", "operador");
    const r = await configurarProprietarioInicialAction({ nome: "Dono", pin: "1234", confirmacaoPin: "1234" });
    expect(r.sucesso).toBe(false);
    expect(await prisma.funcionario.count()).toBe(0);
  });

  it("sem sessão, recusa", async () => {
    const r = await configurarProprietarioInicialAction({ nome: "Dono", pin: "1234", confirmacaoPin: "1234" });
    expect(r.sucesso).toBe(false);
    expect(await prisma.funcionario.count()).toBe(0);
  });
});
