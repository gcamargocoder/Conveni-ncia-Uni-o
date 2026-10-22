import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  verificarAcesso: vi.fn(),
  validarPinAction: vi.fn(),
  criarCliente: vi.fn(),
  atualizarCliente: vi.fn(),
  desativarCliente: vi.fn(),
  excluirCliente: vi.fn(),
  registrarPagamento: vi.fn(),
  buscarConta: vi.fn(),
  buscarDetalheCliente: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/servidor", () => ({ verificarAcesso: m.verificarAcesso }));
vi.mock("@/lib/auth/actions", () => ({ validarPinAction: m.validarPinAction }));
vi.mock("@/services/clientes.service", () => ({
  criarCliente: m.criarCliente,
  atualizarCliente: m.atualizarCliente,
  desativarCliente: m.desativarCliente,
  excluirCliente: m.excluirCliente,
}));
vi.mock("@/services/contas-receber.service", () => ({
  registrarPagamento: m.registrarPagamento,
  buscarConta: m.buscarConta,
  buscarDetalheCliente: m.buscarDetalheCliente,
}));

import {
  criarClienteAction,
  atualizarClienteAction,
  desativarClienteAction,
  excluirClienteAction,
} from "../actions";
import {
  registrarPagamentoAction,
  buscarContaAction,
  buscarDetalheClienteAction,
} from "@/lib/contas-receber/actions";

const cliente = { nome: "Fulano", telefone: null, cpf: null, endereco: null, observacoes: null, ativo: true };
const pagamento = { valor: 10, formaPagamento: "dinheiro", observacoes: "" };

const OPERACOES: {
  nome: string;
  chamar: (pin: string) => Promise<{ sucesso: boolean; erroAutorizacao?: string }>;
  servico: () => ReturnType<typeof vi.fn>;
}[] = [
  { nome: "criarClienteAction", chamar: (p) => criarClienteAction(cliente, p), servico: () => m.criarCliente },
  { nome: "atualizarClienteAction", chamar: (p) => atualizarClienteAction("c1", cliente, p), servico: () => m.atualizarCliente },
  { nome: "desativarClienteAction", chamar: (p) => desativarClienteAction("c1", p), servico: () => m.desativarCliente },
  { nome: "excluirClienteAction", chamar: (p) => excluirClienteAction("c1", p), servico: () => m.excluirCliente },
  { nome: "registrarPagamentoAction", chamar: (p) => registrarPagamentoAction("conta1", pagamento, 50, p), servico: () => m.registrarPagamento },
];

const autorizarComo = (cargo: string) =>
  m.validarPinAction.mockResolvedValue({ sucesso: true, funcionario: { id: "x", nome: "X", cargo } });

beforeEach(() => {
  vi.clearAllMocks();
  m.verificarAcesso.mockResolvedValue({ ok: true, sessao: { usuario: { id: "u1", papel: "operador" } } });
  m.criarCliente.mockResolvedValue({ id: "c1", nome: "Fulano" });
  m.atualizarCliente.mockResolvedValue({});
  m.desativarCliente.mockResolvedValue(undefined);
  m.excluirCliente.mockResolvedValue(undefined);
  m.registrarPagamento.mockResolvedValue({ saldoAtual: 40, status: "PARCIAL" });
  m.buscarConta.mockResolvedValue({ id: "conta1" });
  m.buscarDetalheCliente.mockResolvedValue({ id: "c1" });
});

describe.each(OPERACOES)("$nome", ({ chamar, servico }) => {
  it.each(["proprietario", "gerente"])("PIN de %s autoriza", async (cargo) => {
    autorizarComo(cargo);
    const r = await chamar("1234");
    expect(r.sucesso).toBe(true);
    expect(m.validarPinAction).toHaveBeenCalledWith("1234");
    expect(servico()).toHaveBeenCalled();
  });

  it.each(["caixa", "frentista", "estoquista"])("PIN de %s é recusado no servidor (chamada direta)", async (cargo) => {
    autorizarComo(cargo);
    const r = await chamar("1234");
    expect(r.sucesso).toBe(false);
    expect(r.erroAutorizacao).toBeTruthy();
    expect(servico()).not.toHaveBeenCalled();
  });

  it("PIN incorreto ou bloqueado é recusado", async () => {
    m.validarPinAction.mockResolvedValue({ sucesso: false, erro: "PIN incorreto." });
    const r = await chamar("0000");
    expect(r.sucesso).toBe(false);
    expect(r.erroAutorizacao).toBe("PIN incorreto.");
    expect(servico()).not.toHaveBeenCalled();
  });

  it("chamada direta sem PIN é recusada", async () => {
    m.validarPinAction.mockResolvedValue({ sucesso: false, erro: "PIN incorreto." });
    const r = await chamar("");
    expect(r.sucesso).toBe(false);
    expect(servico()).not.toHaveBeenCalled();
  });

  it("sem sessão de login nem chega a validar o PIN", async () => {
    m.verificarAcesso.mockResolvedValue({ ok: false, erro: "Sua sessão expirou." });
    const r = await chamar("1234");
    expect(r.sucesso).toBe(false);
    expect(m.validarPinAction).not.toHaveBeenCalled();
    expect(servico()).not.toHaveBeenCalled();
  });
});

describe("pagamento de conta a receber", () => {
  it("grava o recebimento em nome de quem autorizou e devolve saldo e status", async () => {
    autorizarComo("gerente");
    const r = await registrarPagamentoAction("conta1", pagamento, 50, "1234");
    expect(r).toMatchObject({ sucesso: true, saldoAtual: 40, status: "PARCIAL" });
    expect(m.registrarPagamento).toHaveBeenCalledWith(
      expect.objectContaining({ contaReceberId: "conta1", valor: 10, funcionarioId: "x" })
    );
  });

  it("valor inválido é recusado antes de qualquer PIN", async () => {
    autorizarComo("gerente");
    const r = await registrarPagamentoAction("conta1", { ...pagamento, valor: 999 }, 50, "1234");
    expect(r.sucesso).toBe(false);
    expect(m.registrarPagamento).not.toHaveBeenCalled();
  });
});

describe("consulta continua liberada a quem está logado (PDV e telas)", () => {
  it("consultar conta e detalhe do cliente não exige PIN", async () => {
    expect(await buscarContaAction("conta1")).toEqual({ id: "conta1" });
    expect(await buscarDetalheClienteAction("c1")).toEqual({ id: "c1" });
    expect(m.validarPinAction).not.toHaveBeenCalled();
  });

  it("sem sessão a consulta devolve null", async () => {
    m.verificarAcesso.mockResolvedValue({ ok: false, erro: "x" });
    expect(await buscarContaAction("conta1")).toBeNull();
  });
});
