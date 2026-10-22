// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

/**
 * Testes de integração da autenticação contra um PostgreSQL REAL de teste.
 * Rodar com: npm run test:integracao (exige TEST_DATABASE_URL, ver o setup).
 */

// --- Simulação de cookies/headers do Next (por requisição de teste) ---------
const ambiente = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  cabecalhos: new Map<string, string>(),
  definidos: [] as { nome: string; valor: string; opcoes: Record<string, unknown> }[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nome: string) => (ambiente.cookies.has(nome) ? { name: nome, value: ambiente.cookies.get(nome)! } : undefined),
    set: (nome: string, valor: string, opcoes: Record<string, unknown> = {}) => {
      ambiente.definidos.push({ nome, valor, opcoes });
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
import { autenticar, emitirRecuperacao, redefinirSenha, solicitarRecuperacao, tokenRecuperacaoValido } from "../auth.service";
import { criarSessao, revogarSessaoPorToken, validarSessao } from "../sessao.service";
import { definirAtivo, definirPapel, listarUsuarios, redefinirAcesso } from "@/services/usuarios.service";
import { criarUsuarioDeTeste as criarUsuario } from "./fixtures-usuarios";
import { hashToken } from "@/lib/auth/token";
import { gerarHashSenha, verificarSenha } from "@/lib/auth/senha";
import { COOKIE_SESSAO, SESSAO_ABSOLUTA_MS, SESSAO_INATIVIDADE_MS, TOKEN_RECUPERACAO_MS } from "@/lib/auth/constantes";
import { loginAction, logoutAction, redefinirSenhaAction, solicitarRecuperacaoAction, verificarSessaoAction } from "@/lib/auth/sessao-actions";
import * as acoesUsuarios from "@/lib/usuarios/actions";
import { alterarAtivoUsuarioAction } from "@/lib/usuarios/actions";
import { criarClienteAction } from "@/lib/clientes/actions";
import { gerarBackupAction } from "@/lib/backup/actions";
import { buscarAlteracoesCatalogoAction } from "@/lib/offline-sync/actions";
import { sincronizarVendaAction } from "@/lib/offline-sync/sincronizar-venda-action";
import { registrarMovimentacaoAction } from "@/lib/estoque/actions";

const SENHA = "Cafe-com-Leite-42";
const MIN = 60 * 1000;

async function limparTudo() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "sessoes", "tokens_recuperacao", "limites_tentativa", "usuarios", "clientes", "tentativas_pin" RESTART IDENTITY CASCADE'
  );
}

async function novoUsuario(email: string, papel: "admin" | "operador" = "operador", ativo = true) {
  const u = await criarUsuario({ nome: `Usuário ${email}`, email, senha: SENHA, papel });
  if (!ativo) await prisma.usuario.update({ where: { id: u.id }, data: { ativo: false } });
  return u;
}

async function entrarComo(email: string) {
  const r = await autenticar({ email, senha: SENHA, ip: "10.0.0.1" });
  if (!r.ok) throw new Error("login de teste falhou");
  ambiente.cookies.set(COOKIE_SESSAO, r.token);
  return r.token;
}

function emailsEnviados() {
  const enviados: { para: string; texto: string }[] = [];
  const enviar = vi.fn(async (m: { para: string; texto: string }) => {
    enviados.push(m);
    return { enviado: true };
  });
  return { enviados, enviar };
}

function extrairToken(texto: string): string {
  const m = texto.match(/token=([\w-]+)/);
  if (!m) throw new Error("e-mail sem link");
  return m[1];
}

beforeEach(async () => {
  await limparTudo();
  ambiente.cookies.clear();
  ambiente.cabecalhos.clear();
  ambiente.definidos.length = 0;
  ambiente.cabecalhos.set("x-real-ip", "203.0.113.7");
});

afterAll(async () => {
  await limparTudo();
  await prisma.$disconnect();
});

// ===========================================================================
describe("login", () => {
  it("login válido cria sessão; no banco ficam só o hash da senha (Argon2id) e o hash do token", async () => {
    await novoUsuario("ana@loja.com");
    const r = await autenticar({ email: "ANA@loja.com ", senha: SENHA, ip: "10.0.0.1" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sessao = await prisma.sessao.findFirstOrThrow();
    expect(sessao.token_hash).toBe(hashToken(r.token));
    expect(sessao.token_hash).not.toBe(r.token);
    const usuario = await prisma.usuario.findFirstOrThrow();
    expect(usuario.senha_hash).toMatch(/^\$argon2id\$/);
    expect(usuario.senha_hash).not.toContain(SENHA);
    expect(usuario.ultimo_login_em).not.toBeNull();
    expect((await validarSessao(r.token))?.usuario.email).toBe("ana@loja.com");
  });

  it("senha errada e e-mail inexistente produzem a MESMA resposta (sem enumeração)", async () => {
    await novoUsuario("ana@loja.com");
    const errada = await autenticar({ email: "ana@loja.com", senha: "Senha-Errada-99", ip: "10.0.0.2" });
    const inexistente = await autenticar({ email: "ninguem@loja.com", senha: "Senha-Errada-99", ip: "10.0.0.3" });
    expect(errada).toEqual({ ok: false, motivo: "credenciais" });
    expect(inexistente).toEqual(errada);

    const a = await loginAction({ email: "ana@loja.com", senha: "Senha-Errada-99" });
    const b = await loginAction({ email: "ninguem@loja.com", senha: "Senha-Errada-99" });
    expect(a).toEqual(b);
    expect(a.erro).toBe("E-mail ou senha incorretos.");
  });

  it("usuário desativado não entra, nem com a senha certa, e a resposta é igual à de senha errada", async () => {
    await novoUsuario("off@loja.com", "operador", false);
    expect(await autenticar({ email: "off@loja.com", senha: SENHA, ip: "10.0.0.1" })).toEqual({
      ok: false,
      motivo: "credenciais",
    });
  });

  it("loginAction grava cookie HttpOnly + SameSite=Lax com validade, e devolve destino seguro", async () => {
    await novoUsuario("ana@loja.com");
    const r = await loginAction({ email: "ana@loja.com", senha: SENHA, next: "//malicioso.com" });
    expect(r.sucesso).toBe(true);
    expect(r.destino).toBe("/");
    const cookie = ambiente.definidos.find((d) => d.nome === COOKIE_SESSAO)!;
    expect(cookie.opcoes).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(cookie.opcoes.expires).toBeInstanceOf(Date);
    expect(cookie.valor).not.toBe("");
    expect(JSON.stringify(r)).not.toContain(cookie.valor); // token nunca volta no corpo da resposta
  });

  it("em produção o cookie é Secure e usa o prefixo __Host-", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    try {
      const constantes = await import("@/lib/auth/constantes");
      const servidor = await import("@/lib/auth/servidor");
      expect(constantes.COOKIE_SESSAO).toBe("__Host-sessao");
      await servidor.definirCookieSessao("tok", new Date(Date.now() + 1000));
      const definido = ambiente.definidos.at(-1)!;
      expect(definido.nome).toBe("__Host-sessao");
      expect(definido.opcoes).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax", path: "/" });
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

// ===========================================================================
describe("bloqueio por tentativas (persistente)", () => {
  it("bloqueia a conta após 5 erros (a 6ª tentativa já é barrada) — até a senha correta é recusada — e o estado fica no banco", async () => {
    await novoUsuario("ana@loja.com");
    for (let i = 0; i < 6; i++) {
      const r = await autenticar({ email: "ana@loja.com", senha: "Errada-12345", ip: `10.0.0.${i}` });
      expect(r.ok).toBe(false);
    }

    const certa = await autenticar({ email: "ana@loja.com", senha: SENHA, ip: "10.0.9.9" });
    expect(certa.ok).toBe(false);
    if (!certa.ok) expect(certa.motivo).toBe("bloqueado");

    // controle persistente: existe linha no banco (vale para qualquer instância do servidor)
    const linhas = await prisma.limiteTentativa.findMany({ where: { chave: { startsWith: "login:conta:" } } });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].bloqueado_ate!.getTime()).toBeGreaterThan(Date.now());
    expect(linhas[0].chave).not.toContain("ana@loja.com"); // e-mail não é gravado em claro
  });

  it("o bloqueio vale também para e-mail inexistente (não revela quais contas existem)", async () => {
    for (let i = 0; i < 6; i++) await autenticar({ email: "fantasma@loja.com", senha: "Errada-12345", ip: `10.1.0.${i}` });
    const r = await autenticar({ email: "fantasma@loja.com", senha: "Errada-12345", ip: "10.1.9.9" });
    expect(r.ok === false && r.motivo).toBe("bloqueado");
  });

  it("expira sozinho e o próximo bloqueio é mais longo (progressivo)", async () => {
    await novoUsuario("ana@loja.com");
    const t0 = new Date();
    for (let i = 0; i < 6; i++) await autenticar({ email: "ana@loja.com", senha: "Errada-12345", ip: "10.0.0.1" }, t0);
    const primeiro = (await prisma.limiteTentativa.findFirstOrThrow({ where: { chave: { startsWith: "login:conta:" } } })).bloqueado_ate!;
    expect(primeiro.getTime() - t0.getTime()).toBe(1 * MIN);

    // passado 1 min o bloqueio acabou: a senha certa entra
    const depois = new Date(t0.getTime() + 61 * 1000);
    expect((await autenticar({ email: "ana@loja.com", senha: SENHA, ip: "10.0.0.1" }, depois)).ok).toBe(true);
  });

  it("segundo bloqueio dura 5 min", async () => {
    await novoUsuario("ana@loja.com");
    const t0 = new Date();
    for (let i = 0; i < 6; i++) await autenticar({ email: "ana@loja.com", senha: "Errada-12345", ip: `10.2.0.${i}` }, t0);
    const t1 = new Date(t0.getTime() + 2 * MIN);
    for (let i = 0; i < 6; i++) await autenticar({ email: "ana@loja.com", senha: "Errada-12345", ip: `10.3.0.${i}` }, t1);
    const linha = await prisma.limiteTentativa.findFirstOrThrow({ where: { chave: { startsWith: "login:conta:" } } });
    expect(linha.bloqueado_ate!.getTime() - t1.getTime()).toBe(5 * MIN);
    expect(linha.nivel).toBe(2);
  });

  it("bloqueia o IP após 20 erros mesmo variando o e-mail", async () => {
    await novoUsuario("ana@loja.com");
    for (let i = 0; i < 20; i++) await autenticar({ email: `alvo${i}@loja.com`, senha: "Errada-12345", ip: "198.51.100.9" });
    const r = await autenticar({ email: "ana@loja.com", senha: SENHA, ip: "198.51.100.9" });
    expect(r.ok === false && r.motivo).toBe("bloqueado");
    // outro IP não é afetado
    expect((await autenticar({ email: "ana@loja.com", senha: SENHA, ip: "198.51.100.10" })).ok).toBe(true);
  });

  it("tentativas simultâneas não furam o contador (travamento por linha)", async () => {
    await novoUsuario("ana@loja.com");
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => autenticar({ email: "ana@loja.com", senha: "Errada-12345", ip: `10.4.0.${i}` }))
    );
    const linha = await prisma.limiteTentativa.findFirstOrThrow({ where: { chave: { startsWith: "login:conta:" } } });
    // 12 tentativas simultâneas: 5 avaliadas + a 6ª dispara UM bloqueio; as demais chegam bloqueadas e não contam
    expect(linha.nivel).toBe(1);
    expect(linha.falhas).toBe(0);
    expect(linha.bloqueado_ate!.getTime()).toBeGreaterThan(Date.now());
  });

  it("login bem-sucedido zera o contador da conta", async () => {
    await novoUsuario("ana@loja.com");
    for (let i = 0; i < 3; i++) await autenticar({ email: "ana@loja.com", senha: "Errada-12345", ip: "10.0.0.1" });
    await autenticar({ email: "ana@loja.com", senha: SENHA, ip: "10.0.0.1" });
    expect(await prisma.limiteTentativa.count({ where: { chave: { startsWith: "login:conta:" } } })).toBe(0);
  });
});

// ===========================================================================
describe("sessão, expiração e logout", () => {
  it("logout invalida a sessão no servidor e limpa o cookie", async () => {
    await novoUsuario("ana@loja.com");
    const token = await entrarComo("ana@loja.com");
    expect((await verificarSessaoAction()).autenticado).toBe(true);

    await logoutAction();

    expect(await validarSessao(token)).toBeNull();
    expect(await prisma.sessao.count()).toBe(0);
    expect(ambiente.cookies.has(COOKIE_SESSAO)).toBe(false);
    expect((await verificarSessaoAction()).autenticado).toBe(false);
  });

  it("um token roubado/copiado não funciona depois do logout", async () => {
    await novoUsuario("ana@loja.com");
    const token = await entrarComo("ana@loja.com");
    await logoutAction();
    ambiente.cookies.set(COOKIE_SESSAO, token); // atacante reapresenta o cookie antigo
    expect((await verificarSessaoAction()).autenticado).toBe(false);
  });

  it("expira por inatividade e por teto absoluto", async () => {
    const u = await novoUsuario("ana@loja.com");
    const t0 = new Date();
    const { token } = await criarSessao(u.id, {}, t0);

    expect(await validarSessao(token, new Date(t0.getTime() + SESSAO_INATIVIDADE_MS - MIN))).not.toBeNull();
    // (a validação acima renovou a janela) → 12 h + 1 min sem uso a partir dela expira
    const aposUso = new Date(t0.getTime() + SESSAO_INATIVIDADE_MS - MIN);
    expect(await validarSessao(token, new Date(aposUso.getTime() + SESSAO_INATIVIDADE_MS + MIN))).toBeNull();

    const { token: t2 } = await criarSessao(u.id, {}, t0);
    // uso contínuo a cada 6 h, mas passou do teto de 7 dias
    let relogio = t0.getTime();
    while (relogio + 6 * 60 * MIN < t0.getTime() + SESSAO_ABSOLUTA_MS) {
      relogio += 6 * 60 * MIN;
      expect(await validarSessao(t2, new Date(relogio))).not.toBeNull();
    }
    expect(await validarSessao(t2, new Date(t0.getTime() + SESSAO_ABSOLUTA_MS + 1))).toBeNull();
  });

  it("a renovação nunca ultrapassa o teto absoluto", async () => {
    const u = await novoUsuario("ana@loja.com");
    const t0 = new Date();
    const { token } = await criarSessao(u.id, {}, t0);
    // uso contínuo (a cada 6 h) até poucos minutos antes do teto de 7 dias
    const limite = t0.getTime() + SESSAO_ABSOLUTA_MS - 5 * MIN;
    for (let relogio = t0.getTime() + 6 * 60 * MIN; relogio < limite; relogio += 6 * 60 * MIN) {
      expect(await validarSessao(token, new Date(relogio))).not.toBeNull();
    }
    expect(await validarSessao(token, new Date(limite))).not.toBeNull();
    const s = await prisma.sessao.findFirstOrThrow();
    expect(s.expira_em.getTime()).toBeLessThanOrEqual(s.expira_absoluta_em.getTime());
  });

  it("cada login gera um token novo (sem fixação de sessão)", async () => {
    await novoUsuario("ana@loja.com");
    const a = await autenticar({ email: "ana@loja.com", senha: SENHA, ip: "10.0.0.1" });
    const b = await autenticar({ email: "ana@loja.com", senha: SENHA, ip: "10.0.0.1" });
    expect(a.ok && b.ok && a.token !== b.token).toBe(true);
  });

  it("token malformado, vazio ou enorme é rejeitado", async () => {
    expect(await validarSessao("")).toBeNull();
    expect(await validarSessao(undefined)).toBeNull();
    expect(await validarSessao("x".repeat(5000))).toBeNull();
    expect(await validarSessao("token-que-nao-existe")).toBeNull();
  });
});

// ===========================================================================
describe("autorização no servidor", () => {
  it("sem sessão: todas as Server Actions de negócio e administrativas são recusadas", async () => {
    const negado = "Sua sessão expirou. Entre novamente para continuar.";

    expect(await criarClienteAction({ nome: "Fulano" }, "1234")).toMatchObject({ sucesso: false, erroGeral: negado });
    expect(await gerarBackupAction()).toMatchObject({ sucesso: false, erro: negado });
    expect(await registrarMovimentacaoAction({ produto_id: "x", tipo: "entrada", quantidade: 1 }, "1234")).toMatchObject({ sucesso: false });
    await expect(buscarAlteracoesCatalogoAction(null)).rejects.toThrow(negado);

    expect(await prisma.cliente.count()).toBe(0);
    expect(await prisma.usuario.count()).toBe(0);
  });

  it("operador comum: usa o sistema, mas não gerencia usuários nem baixa/restaura backup", async () => {
    await novoUsuario("op@loja.com", "operador");
    await entrarComo("op@loja.com");

    // Cadastrar cliente agora exige também o PIN de proprietário/gerente: só o login não basta.
    expect((await criarClienteAction({ nome: "Fulano" }, "")).sucesso).toBe(false);
    await expect(buscarAlteracoesCatalogoAction(null)).resolves.toBeDefined();

    expect((await gerarBackupAction()).sucesso).toBe(false);
    expect((await alterarAtivoUsuarioAction("00000000-0000-0000-0000-000000000000", false)).sucesso).toBe(false);
  });

  it("administrador gera backup (e não há ação para criar contas de login)", async () => {
    await novoUsuario("adm@loja.com", "admin");
    await entrarComo("adm@loja.com");

    expect(Object.keys(acoesUsuarios).some((n) => /criar/i.test(n))).toBe(false);
    expect((await gerarBackupAction()).sucesso).toBe(true);
  });

  it("sessão de quem foi desativado deixa de valer imediatamente", async () => {
    await novoUsuario("adm@loja.com", "admin");
    const op = await novoUsuario("op@loja.com", "operador");
    await entrarComo("op@loja.com");
    await expect(buscarAlteracoesCatalogoAction(null)).resolves.toBeDefined();

    await definirAtivo(op.id, false, "outro");

    await expect(buscarAlteracoesCatalogoAction(null)).rejects.toThrow();
    expect(await prisma.sessao.count({ where: { usuario_id: op.id } })).toBe(0);
  });

  it("rebaixar um admin para operador encerra as sessões dele (privilégio não persiste)", async () => {
    const a1 = await novoUsuario("a1@loja.com", "admin");
    await novoUsuario("a2@loja.com", "admin");
    await entrarComo("a1@loja.com");
    await definirPapel(a1.id, "operador", "a2");
    expect((await gerarBackupAction()).sucesso).toBe(false);
  });

  it("não há como criar contas de login: nenhuma Server Action de criação existe, nem para admin", async () => {
    // única conta principal: a criação é feita só pelo script de infraestrutura (npm run admin:criar)
    expect(Object.keys(acoesUsuarios).filter((n) => /criar|cadastr|novo/i.test(n))).toEqual([]);
    expect(await prisma.usuario.count()).toBe(0);
  });

  it("a fila offline: venda enviada sem sessão volta com requerLogin e NADA é gravado", async () => {
    const r = await sincronizarVendaAction("11111111-1111-4111-8111-111111111111", {
      funcionario_id: "x",
      forma_pagamento: "pix",
      total: 1,
      itens: [{ produto_id: "x", quantidade: 1, preco_unitario: 1 }],
    });
    expect(r).toMatchObject({ sucesso: false, requerLogin: true });
    expect(await prisma.venda.count()).toBe(0);
  });
});

// ===========================================================================
describe("gestão de usuários", () => {
  it("o banco rejeita e-mail duplicado (case-insensitive)", async () => {
    await novoUsuario("ana@loja.com");
    await expect(criarUsuario({ nome: "Outra", email: "ANA@loja.com", senha: SENHA, papel: "operador" })).rejects.toThrow();
  });

  it("nunca deixa o sistema sem administrador ativo (desativar / rebaixar o último)", async () => {
    const unico = await novoUsuario("adm@loja.com", "admin");
    const op = await novoUsuario("op@loja.com", "operador");

    await expect(definirAtivo(unico.id, false, op.id)).rejects.toThrow(/última conta de administrador/);
    await expect(definirPapel(unico.id, "operador", op.id)).rejects.toThrow(/última conta de administrador/);

    const outro = await novoUsuario("adm2@loja.com", "admin");
    await expect(definirAtivo(unico.id, false, outro.id)).resolves.toBeUndefined(); // agora há outro
    await expect(definirAtivo(outro.id, false, op.id)).rejects.toThrow(/última conta de administrador/);
  });

  it("ninguém desativa o próprio acesso", async () => {
    const a = await novoUsuario("a@loja.com", "admin");
    await novoUsuario("b@loja.com", "admin");
    await expect(definirAtivo(a.id, false, a.id)).rejects.toThrow(/próprio acesso/);
  });

  it("dois admins tentando se desativar ao mesmo tempo: sempre sobra um (corrida)", async () => {
    const a = await novoUsuario("a@loja.com", "admin");
    const b = await novoUsuario("b@loja.com", "admin");
    const resultados = await Promise.allSettled([definirAtivo(a.id, false, b.id), definirAtivo(b.id, false, a.id)]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.usuario.count({ where: { papel: "admin", ativo: true } })).toBe(1);
  });

  it("listarUsuarios não expõe hash de senha", async () => {
    await novoUsuario("a@loja.com");
    const lista = await listarUsuarios();
    expect(Object.keys(lista[0])).not.toContain("senha_hash");
    expect(JSON.stringify(lista)).not.toContain("argon2");
  });

  it("'redefinir acesso' encerra as sessões e envia link; sem e-mail configurado, avisa sem simular sucesso", async () => {
    const op = await novoUsuario("op@loja.com");
    const { token } = await criarSessao(op.id, {});
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    try {
      const r = await redefinirAcesso(op.id);
      expect(r).toEqual({ enviado: false, motivo: "nao_configurado" });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await validarSessao(token)).toBeNull();
  });
});

// ===========================================================================
describe("recuperação de senha", () => {
  it("fluxo completo: e-mail com link, nova senha, sessões antigas encerradas, senha antiga morre", async () => {
    const u = await novoUsuario("ana@loja.com");
    const { token: sessaoAntiga } = await criarSessao(u.id, {});
    const { enviados, enviar } = emailsEnviados();

    const { envio } = await solicitarRecuperacao({ email: "Ana@loja.com", ip: "10.0.0.1" }, enviar);
    await envio;

    expect(enviados).toHaveLength(1);
    expect(enviados[0].para).toBe("ana@loja.com");
    const token = extrairToken(enviados[0].texto);

    // só o hash do token fica no banco
    const registro = await prisma.tokenRecuperacao.findFirstOrThrow();
    expect(registro.token_hash).toBe(hashToken(token));
    expect(registro.token_hash).not.toContain(token);

    expect(await tokenRecuperacaoValido(token)).toBe(true);
    const r = await redefinirSenha({ token, novaSenha: "Nova-Senha-2026x", ip: "10.0.0.1" });
    expect(r).toEqual({ ok: true });

    expect(await validarSessao(sessaoAntiga)).toBeNull();
    expect((await autenticar({ email: "ana@loja.com", senha: SENHA, ip: "10.0.0.1" })).ok).toBe(false);
    expect((await autenticar({ email: "ana@loja.com", senha: "Nova-Senha-2026x", ip: "10.0.0.1" })).ok).toBe(true);
  });

  it("e-mail inexistente: mesma resposta, nenhum e-mail enviado, nenhum token criado", async () => {
    await novoUsuario("ana@loja.com");
    const { enviados, enviar } = emailsEnviados();
    const existente = await solicitarRecuperacao({ email: "ana@loja.com", ip: "10.0.0.1" }, enviar);
    const inexistente = await solicitarRecuperacao({ email: "fantasma@loja.com", ip: "10.0.0.2" }, enviar);
    await existente.envio;

    expect(inexistente.envio).toBeNull();
    expect(enviados).toHaveLength(1);

    // pela action pública a resposta é idêntica
    const a = await solicitarRecuperacaoAction({ email: "ana@loja.com" });
    const b = await solicitarRecuperacaoAction({ email: "fantasma@loja.com" });
    expect(a).toEqual(b);
  });

  it("usuário desativado não recebe link", async () => {
    await novoUsuario("off@loja.com", "operador", false);
    const { enviados, enviar } = emailsEnviados();
    const { envio } = await solicitarRecuperacao({ email: "off@loja.com", ip: "10.0.0.1" }, enviar);
    expect(envio).toBeNull();
    expect(enviados).toHaveLength(0);
  });

  it("token expirado é recusado", async () => {
    const u = await novoUsuario("ana@loja.com");
    const { enviados, enviar } = emailsEnviados();
    const t0 = new Date();
    await emitirRecuperacao(u, enviar, t0);
    const token = extrairToken(enviados[0].texto);

    const tarde = new Date(t0.getTime() + TOKEN_RECUPERACAO_MS + 1000);
    expect(await tokenRecuperacaoValido(token, tarde)).toBe(false);
    expect(await redefinirSenha({ token, novaSenha: "Nova-Senha-2026x", ip: "10.0.0.1" }, tarde)).toEqual({
      ok: false,
      motivo: "token_invalido",
    });
    expect((await autenticar({ email: "ana@loja.com", senha: SENHA, ip: "10.0.0.1" })).ok).toBe(true); // senha intacta
  });

  it("token é de uso único (reutilização falha)", async () => {
    const u = await novoUsuario("ana@loja.com");
    const { enviados, enviar } = emailsEnviados();
    await emitirRecuperacao(u, enviar);
    const token = extrairToken(enviados[0].texto);

    expect((await redefinirSenha({ token, novaSenha: "Nova-Senha-2026x", ip: "10.0.0.1" })).ok).toBe(true);
    expect(await redefinirSenha({ token, novaSenha: "Outra-Senha-2027y", ip: "10.0.0.1" })).toEqual({
      ok: false,
      motivo: "token_invalido",
    });
    expect((await autenticar({ email: "ana@loja.com", senha: "Nova-Senha-2026x", ip: "10.0.0.1" })).ok).toBe(true);
  });

  it("uso simultâneo do mesmo token: só um vence", async () => {
    const u = await novoUsuario("ana@loja.com");
    const { enviados, enviar } = emailsEnviados();
    await emitirRecuperacao(u, enviar);
    const token = extrairToken(enviados[0].texto);

    const [r1, r2] = await Promise.all([
      redefinirSenha({ token, novaSenha: "Senha-Vencedora-1a", ip: "10.0.0.1" }),
      redefinirSenha({ token, novaSenha: "Senha-Vencedora-2b", ip: "10.0.0.2" }),
    ]);
    expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
  });

  it("um novo pedido invalida o link anterior", async () => {
    const u = await novoUsuario("ana@loja.com");
    const { enviados, enviar } = emailsEnviados();
    await emitirRecuperacao(u, enviar);
    await emitirRecuperacao(u, enviar);
    const [antigo, novo] = enviados.map((e) => extrairToken(e.texto));

    expect(await tokenRecuperacaoValido(antigo)).toBe(false);
    expect(await tokenRecuperacaoValido(novo)).toBe(true);
  });

  it("senha fraca não consome o token (a pessoa pode tentar de novo)", async () => {
    const u = await novoUsuario("ana@loja.com");
    const { enviados, enviar } = emailsEnviados();
    await emitirRecuperacao(u, enviar);
    const token = extrairToken(enviados[0].texto);

    const fraca = await redefinirSenha({ token, novaSenha: "123", ip: "10.0.0.1" });
    expect(fraca.ok === false && fraca.motivo).toBe("senha_fraca");
    expect((await redefinirSenha({ token, novaSenha: "Nova-Senha-2026x", ip: "10.0.0.1" })).ok).toBe(true);
  });

  it("token inventado é recusado e conta contra o limite do IP", async () => {
    for (let i = 0; i < 10; i++) {
      expect(await redefinirSenha({ token: `chute-${i}`, novaSenha: "Nova-Senha-2026x", ip: "192.0.2.1" })).toEqual({
        ok: false,
        motivo: "token_invalido",
      });
    }
    const r = await redefinirSenha({ token: "chute-final", novaSenha: "Nova-Senha-2026x", ip: "192.0.2.1" });
    expect(r.ok === false && r.motivo).toBe("bloqueado");
  });

  it("limita pedidos de recuperação por e-mail (3/hora) sem alterar a resposta ao usuário", async () => {
    await novoUsuario("ana@loja.com");
    const { enviados, enviar } = emailsEnviados();
    for (let i = 0; i < 6; i++) {
      const { envio } = await solicitarRecuperacao({ email: "ana@loja.com", ip: `10.0.${i}.1` }, enviar);
      await envio;
    }
    expect(enviados.length).toBe(3);
  });

  it("redefinirSenhaAction exige confirmação igual e não vaza detalhes do token", async () => {
    const u = await novoUsuario("ana@loja.com");
    const { enviados, enviar } = emailsEnviados();
    await emitirRecuperacao(u, enviar);
    const token = extrairToken(enviados[0].texto);

    expect(await redefinirSenhaAction({ token, senha: "Nova-Senha-2026x", confirmacao: "diferente" })).toMatchObject({
      sucesso: false,
      erro: "A confirmação não é igual à nova senha.",
    });
    const invalido = await redefinirSenhaAction({ token: "nada", senha: "Nova-Senha-2026x", confirmacao: "Nova-Senha-2026x" });
    expect(invalido.erro).toBe("Este link é inválido ou expirou. Solicite um novo.");
  });

  it("redefinir a senha também zera o bloqueio por tentativas da conta", async () => {
    const u = await novoUsuario("ana@loja.com");
    for (let i = 0; i < 5; i++) await autenticar({ email: "ana@loja.com", senha: "Errada-12345", ip: `10.5.0.${i}` });
    expect((await autenticar({ email: "ana@loja.com", senha: SENHA, ip: "10.5.9.9" })).ok).toBe(false);

    const { enviados, enviar } = emailsEnviados();
    await emitirRecuperacao(u, enviar);
    await redefinirSenha({ token: extrairToken(enviados[0].texto), novaSenha: "Nova-Senha-2026x", ip: "10.5.9.9" });

    expect((await autenticar({ email: "ana@loja.com", senha: "Nova-Senha-2026x", ip: "10.5.9.9" })).ok).toBe(true);
  });

  it("o link usa APP_URL (nunca o cabeçalho Host da requisição)", async () => {
    const u = await novoUsuario("ana@loja.com");
    vi.stubEnv("APP_URL", "https://conveniencia.exemplo.com/");
    const { enviados, enviar } = emailsEnviados();
    try {
      await emitirRecuperacao(u, enviar);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(enviados[0].texto).toContain("https://conveniencia.exemplo.com/redefinir-senha?token=");
  });

  it("em produção, sem APP_URL, nenhum link é montado nem enviado", async () => {
    const u = await novoUsuario("ana@loja.com");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "");
    const { enviados, enviar } = emailsEnviados();
    try {
      expect(await emitirRecuperacao(u, enviar)).toEqual({ enviado: false, motivo: "nao_configurado" });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(enviados).toHaveLength(0);
    expect(await prisma.tokenRecuperacao.count()).toBe(0);
  });
});

// ===========================================================================
describe("hash legado e integridade do banco", () => {
  it("o banco recusa e-mail com maiúsculas e papéis inválidos (CHECK)", async () => {
    const hash = await gerarHashSenha(SENHA);
    await expect(prisma.usuario.create({ data: { email: "Maiuscula@x.com", nome: "x", senha_hash: hash } })).rejects.toThrow();
    await expect(prisma.usuario.create({ data: { email: "ok@x.com", nome: "x", senha_hash: hash, papel: "root" } })).rejects.toThrow();
    expect(await verificarSenha(SENHA, hash)).toBe(true);
  });
});
