import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => {
  class ProprietarioJaConfiguradoError extends Error {}
  return {
    ProprietarioJaConfiguradoError,
    verificarAcesso: vi.fn(),
    validarPinAction: vi.fn(),
    criarFuncionario: vi.fn(),
    buscarFuncionarioPorId: vi.fn(),
    atualizarFuncionario: vi.fn(),
    excluirFuncionario: vi.fn(),
    contarProprietariosAtivos: vi.fn(),
    pinEmUsoPorOutro: vi.fn(),
    criarProprietarioInicial: vi.fn(),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/servidor", () => ({ verificarAcesso: m.verificarAcesso }));
vi.mock("@/lib/auth/actions", () => ({ validarPinAction: m.validarPinAction }));
vi.mock("@/services/funcionarios.service", () => ({
  criarFuncionario: m.criarFuncionario,
  buscarFuncionarioPorId: m.buscarFuncionarioPorId,
  atualizarFuncionario: m.atualizarFuncionario,
  excluirFuncionario: m.excluirFuncionario,
  contarProprietariosAtivos: m.contarProprietariosAtivos,
  pinEmUsoPorOutro: m.pinEmUsoPorOutro,
  criarProprietarioInicial: m.criarProprietarioInicial,
  ProprietarioJaConfiguradoError: m.ProprietarioJaConfiguradoError,
}));

import {
  configurarProprietarioInicialAction,
  criarFuncionarioAction,
  atualizarFuncionarioAction,
  excluirFuncionarioAction,
} from "../funcionarios-actions";

const sessaoAdmin = { ok: true, sessao: { usuario: { id: "u1", papel: "admin" } } };
const autorizar = (cargo: string, id = "autorizador") =>
  m.validarPinAction.mockResolvedValue({ sucesso: true, funcionario: { id, nome: "X", cargo } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  m.verificarAcesso.mockResolvedValue(sessaoAdmin);
  m.pinEmUsoPorOutro.mockResolvedValue(false);
  m.contarProprietariosAtivos.mockResolvedValue(1);
  m.criarProprietarioInicial.mockResolvedValue({ id: "novo" });
});

describe("configuração inicial do proprietário", () => {
  const dados = { nome: "Dono", pin: "4321", confirmacaoPin: "4321" };

  // Antes da configuração inicial não há proprietário ativo.
  beforeEach(() => m.contarProprietariosAtivos.mockResolvedValue(0));

  it("com proprietário já configurado, recusa sem comparar o PIN com os de ninguém (não vira sonda)", async () => {
    m.contarProprietariosAtivos.mockResolvedValue(1);
    m.pinEmUsoPorOutro.mockResolvedValue(true);
    const r = await configurarProprietarioInicialAction(dados);
    expect(r.sucesso).toBe(false);
    expect(r.erro).toMatch(/já foi configurado/);
    expect(m.pinEmUsoPorOutro).not.toHaveBeenCalled();
    expect(m.criarProprietarioInicial).not.toHaveBeenCalled();
  });

  it("o administrador do login cria o primeiro proprietário", async () => {
    const r = await configurarProprietarioInicialAction(dados);
    expect(r.sucesso).toBe(true);
    expect(m.verificarAcesso).toHaveBeenCalledWith("admin");
    expect(m.criarProprietarioInicial).toHaveBeenCalledWith({ nome: "Dono", pin: "4321" });
  });

  it("usuário de login que não é admin não configura", async () => {
    m.verificarAcesso.mockResolvedValue({ ok: false, erro: "Acesso restrito a administradores." });
    const r = await configurarProprietarioInicialAction(dados);
    expect(r.sucesso).toBe(false);
    expect(m.criarProprietarioInicial).not.toHaveBeenCalled();
  });

  it("sem sessão não configura", async () => {
    m.verificarAcesso.mockResolvedValue({ ok: false, erro: "Sua sessão expirou." });
    expect((await configurarProprietarioInicialAction(dados)).sucesso).toBe(false);
    expect(m.criarProprietarioInicial).not.toHaveBeenCalled();
  });

  it("não reabre: se já existe proprietário, o serviço recusa e nada é substituído", async () => {
    m.criarProprietarioInicial.mockRejectedValue(new m.ProprietarioJaConfiguradoError());
    const r = await configurarProprietarioInicialAction(dados);
    expect(r.sucesso).toBe(false);
    expect(r.erro).toMatch(/já foi configurado/);
    expect(m.atualizarFuncionario).not.toHaveBeenCalled();
  });

  it("rejeita PIN fora do formato, confirmação divergente e nome curto", async () => {
    expect((await configurarProprietarioInicialAction({ ...dados, pin: "12", confirmacaoPin: "12" })).sucesso).toBe(false);
    expect((await configurarProprietarioInicialAction({ ...dados, confirmacaoPin: "1111" })).sucesso).toBe(false);
    expect((await configurarProprietarioInicialAction({ ...dados, nome: " " })).sucesso).toBe(false);
    expect(m.criarProprietarioInicial).not.toHaveBeenCalled();
  });

  it("rejeita PIN já usado por outro funcionário", async () => {
    m.pinEmUsoPorOutro.mockResolvedValue(true);
    expect((await configurarProprietarioInicialAction(dados)).sucesso).toBe(false);
    expect(m.criarProprietarioInicial).not.toHaveBeenCalled();
  });
});

describe("cadastro de funcionário", () => {
  const novo = { nome: "Maria", cargo: "caixa" as const, pin: "1111" };

  it.each(["proprietario", "gerente"])("PIN de %s autoriza o cadastro", async (cargo) => {
    autorizar(cargo);
    expect((await criarFuncionarioAction(novo, "0000")).sucesso).toBe(true);
    expect(m.criarFuncionario).toHaveBeenCalledWith(novo);
  });

  it.each(["caixa", "frentista", "estoquista"])("PIN de %s NÃO autoriza o cadastro", async (cargo) => {
    autorizar(cargo);
    const r = await criarFuncionarioAction(novo, "0000");
    expect(r.sucesso).toBe(false);
    expect(m.criarFuncionario).not.toHaveBeenCalled();
  });

  it("PIN de autorização inválido bloqueia", async () => {
    m.validarPinAction.mockResolvedValue({ sucesso: false, erro: "PIN incorreto." });
    expect((await criarFuncionarioAction(novo, "9999")).sucesso).toBe(false);
    expect(m.criarFuncionario).not.toHaveBeenCalled();
  });

  it("o gerente pode cadastrar outro gerente", async () => {
    autorizar("gerente");
    expect((await criarFuncionarioAction({ ...novo, cargo: "gerente" }, "0000")).sucesso).toBe(true);
  });

  it("recusa PIN já em uso por outro funcionário (identificação ambígua)", async () => {
    autorizar("proprietario");
    m.pinEmUsoPorOutro.mockResolvedValue(true);
    expect((await criarFuncionarioAction(novo, "0000")).sucesso).toBe(false);
    expect(m.criarFuncionario).not.toHaveBeenCalled();
  });

  it("exige sessão de login antes de qualquer coisa", async () => {
    m.verificarAcesso.mockResolvedValue({ ok: false, erro: "Sua sessão expirou." });
    expect((await criarFuncionarioAction(novo, "0000")).sucesso).toBe(false);
    expect(m.validarPinAction).not.toHaveBeenCalled();
  });
});

describe("edição e exclusão", () => {
  it.each(["proprietario", "gerente"])("%s gerencia qualquer cargo, inclusive PINs", async (cargo) => {
    autorizar(cargo);
    for (const alvo of ["caixa", "gerente", "proprietario"]) {
      m.buscarFuncionarioPorId.mockResolvedValue({ id: "alvo", cargo: alvo, ativo: true });
      expect((await atualizarFuncionarioAction("alvo", { pin: "5555" }, "0000")).sucesso).toBe(true);
    }
  });

  it("caixa não edita nem exclui ninguém", async () => {
    autorizar("caixa");
    m.buscarFuncionarioPorId.mockResolvedValue({ id: "alvo", cargo: "frentista", ativo: true });
    expect((await atualizarFuncionarioAction("alvo", { nome: "Zé" }, "0000")).sucesso).toBe(false);
    expect((await excluirFuncionarioAction("alvo", "0000")).sucesso).toBe(false);
    expect(m.atualizarFuncionario).not.toHaveBeenCalled();
    expect(m.excluirFuncionario).not.toHaveBeenCalled();
  });

  it("não exclui nem rebaixa o único proprietário ativo (reabriria a configuração inicial)", async () => {
    autorizar("gerente");
    m.buscarFuncionarioPorId.mockResolvedValue({ id: "dono", cargo: "proprietario", ativo: true });
    m.contarProprietariosAtivos.mockResolvedValue(1);
    expect((await excluirFuncionarioAction("dono", "0000")).sucesso).toBe(false);
    expect((await atualizarFuncionarioAction("dono", { cargo: "caixa" }, "0000")).sucesso).toBe(false);
    expect(m.excluirFuncionario).not.toHaveBeenCalled();
    expect(m.atualizarFuncionario).not.toHaveBeenCalled();
  });

  it("com mais de um proprietário, é possível excluir um deles", async () => {
    autorizar("proprietario", "outro");
    m.buscarFuncionarioPorId.mockResolvedValue({ id: "dono", cargo: "proprietario", ativo: true });
    m.contarProprietariosAtivos.mockResolvedValue(2);
    expect((await excluirFuncionarioAction("dono", "0000")).sucesso).toBe(true);
  });
});
