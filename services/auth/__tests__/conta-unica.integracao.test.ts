// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

/**
 * Regra definitiva: UMA conta principal de login (e-mail + senha). A tela Usuários não cria contas.
 * Funcionários/PINs (operacionais) são outra coisa e continuam funcionando.
 * Contra PostgreSQL REAL de teste: npm run test:integracao.
 */
const ambiente = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  cabecalhos: new Map<string, string>(),
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

import { prisma } from "@/services/prisma/client";
import { autenticar } from "../auth.service";
import * as servicoUsuarios from "@/services/usuarios.service";
import * as acoesUsuarios from "@/lib/usuarios/actions";
import { COOKIE_SESSAO } from "@/lib/auth/constantes";
import { gerarHashPin } from "@/lib/auth/pin";
import { criarFuncionarioAction, atualizarFuncionarioAction } from "@/lib/auth/funcionarios-actions";
import { validarPinAction } from "@/lib/auth/actions";
import { criarUsuarioDeTeste } from "./fixtures-usuarios";

const SENHA = "Cafe-com-Leite-42";

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "sessoes", "tokens_recuperacao", "limites_tentativa", "usuarios", "tentativas_pin", "funcionarios" RESTART IDENTITY CASCADE'
  );
  ambiente.cookies.clear();
  ambiente.cabecalhos.clear();
  ambiente.cabecalhos.set("x-real-ip", "203.0.113.9");
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function entrar(email: string) {
  const r = await autenticar({ email, senha: SENHA, ip: "10.0.0.1" });
  if (!r.ok) throw new Error("login de teste falhou");
  ambiente.cookies.set(COOKIE_SESSAO, r.token);
}

describe("conta principal única", () => {
  it("a conta principal continua entrando; senha errada não", async () => {
    await criarUsuarioDeTeste({ nome: "Dono", email: "dono@loja.com", senha: SENHA, papel: "admin" });
    expect((await autenticar({ email: "dono@loja.com", senha: SENHA, ip: "10.0.0.1" })).ok).toBe(true);
    expect((await autenticar({ email: "dono@loja.com", senha: "errada-errada-1", ip: "10.0.0.1" })).ok).toBe(false);
  });

  it("não existe nenhuma função/ação de criação de conta de login (serviço ou Server Action)", () => {
    const nomes = [...Object.keys(servicoUsuarios), ...Object.keys(acoesUsuarios)];
    expect(nomes.filter((n) => /criar|cadastr|novo|registr|signup/i.test(n))).toEqual([]);
  });

  it("nem o administrador logado consegue acrescentar contas: tudo o que há na tela mantém a contagem", async () => {
    const dono = await criarUsuarioDeTeste({ nome: "Dono", email: "dono@loja.com", senha: SENHA, papel: "admin" });
    await entrar("dono@loja.com");
    // chama TODAS as ações administrativas exportadas, inclusive com argumentos forjados
    for (const [nome, acao] of Object.entries(acoesUsuarios)) {
      if (typeof acao !== "function") continue;
      await (acao as (...a: unknown[]) => Promise<unknown>)(dono.id, true, { nome: "Intruso", email: "i@x.com", senha: SENHA }).catch(() => undefined);
      expect(await prisma.usuario.count(), nome).toBe(1);
    }
  });

  it("o script de provisionamento recusa criar uma segunda conta", async () => {
    await criarUsuarioDeTeste({ nome: "Dono", email: "dono@loja.com", senha: SENHA, papel: "admin" });
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "scripts/criar-admin.ts", "--email", "outro@loja.com", "--nome", "Outro"],
      { env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL!, ADMIN_SENHA: SENHA }, encoding: "utf8" }
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/administrador ativo|única conta/i);
    expect(await prisma.usuario.count()).toBe(1);
  });

  it("contas legadas adicionais são preservadas (nada é apagado) e continuam desativáveis", async () => {
    const dono = await criarUsuarioDeTeste({ nome: "Dono", email: "dono@loja.com", senha: SENHA, papel: "admin" });
    const extra = await criarUsuarioDeTeste({ nome: "Legado", email: "legado@loja.com", senha: SENHA, papel: "operador" });
    expect(await servicoUsuarios.listarUsuarios()).toHaveLength(2);
    await servicoUsuarios.definirAtivo(extra.id, false, dono.id);
    expect(await prisma.usuario.count()).toBe(2);
    expect((await prisma.usuario.findUnique({ where: { id: extra.id } }))?.ativo).toBe(false);
    expect((await autenticar({ email: "legado@loja.com", senha: SENHA, ip: "10.0.0.2" })).ok).toBe(false);
  });
});

describe("funcionários e PINs continuam operacionais (independentes da conta de login)", () => {
  it("criar e editar funcionário com PIN, sem criar conta de login", async () => {
    await criarUsuarioDeTeste({ nome: "Dono", email: "dono@loja.com", senha: SENHA, papel: "admin" });
    await entrar("dono@loja.com");
    const dono = await prisma.funcionario.create({ data: { nome: "Dono PDV", cargo: "proprietario", pin_hash: await gerarHashPin("1234") } });

    expect((await validarPinAction("1234")).sucesso).toBe(true);
    expect((await validarPinAction("0000")).sucesso).toBe(false);

    const criado = await criarFuncionarioAction({ nome: "Maria Caixa", cargo: "caixa", pin: "4321" }, "1234");
    expect(criado.sucesso).toBe(true);
    const maria = await prisma.funcionario.findFirstOrThrow({ where: { nome: "Maria Caixa" } });
    expect(maria.pin_hash).not.toContain("4321");
    const antes = maria.pin_hash;

    expect((await atualizarFuncionarioAction(maria.id, { pin: "5555" }, "1234")).sucesso).toBe(true);
    expect((await prisma.funcionario.findUniqueOrThrow({ where: { id: maria.id } })).pin_hash).not.toBe(antes);

    expect(await prisma.usuario.count()).toBe(1);
    expect(dono.id).toBeTruthy();
  });
});
