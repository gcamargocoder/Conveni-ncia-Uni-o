// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

/**
 * Controle de caixa contra um PostgreSQL REAL de teste (npm run test:integracao, exige
 * TEST_DATABASE_URL terminado em _test). Cobre abertura, vendas por forma, pagamento dividido, suprimento,
 * sangria, despesa, estorno, fechamento (correto e com divergência), permissões, movimentação depois do
 * fechamento, reabertura, imutabilidade, idempotência/reenvio e concorrência.
 */

const ambiente = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  cabecalhos: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nome: string) => (ambiente.cookies.has(nome) ? { name: nome, value: ambiente.cookies.get(nome)! } : undefined),
    set: (nome: string, valor: string) => {
      if (valor === "") ambiente.cookies.delete(nome);
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

import { randomUUID } from "node:crypto";
import { prisma } from "@/services/prisma/client";
import { autenticar } from "@/services/auth/auth.service";
import { criarUsuarioDeTeste as criarUsuario } from "../../auth/__tests__/fixtures-usuarios";
import { gerarHashPin } from "@/lib/auth/pin";
import { COOKIE_SESSAO } from "@/lib/auth/constantes";
import { sincronizarVendaAction, type PayloadVendaFila } from "@/lib/offline-sync/sincronizar-venda-action";
import {
  conferirCaixaAction,
  detalheCaixaAction,
  listarCaixasAction,
  listarConflitosCaixaAction,
  reabrirCaixaAction,
  relatorioCaixaAction,
  autorizarOperacaoCaixaAction,
  recebimentosDoCaixaAction,
  sincronizarOperacaoCaixaAction,
  type OperacaoCaixa,
  type ResultadoSincronizarCaixa,
} from "@/lib/caixa/actions";
import { registrarVenda } from "@/services/vendas.service";
import { registrarPagamento } from "@/services/contas-receber.service";
import { resumoDoCaixa } from "@/services/caixa.service";
import { aprovarVendaRevisaoAction } from "@/lib/vendas/revisao-actions";

const SENHA = "Cafe-com-Leite-42";
const TERMINAL = "terminal-A";
const OUTRO_TERMINAL = "terminal-B";

const ids = { produto: "", frentista: "", gerente: "", estoquista: "", inativo: "", cliente: "", operador: "", admin: "" };

async function limparTudo() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "autorizacoes_caixa", "auditoria_caixa", "movimentos_caixa", "caixa_conflitos", "caixas", "vendas_revisao", "recebimentos", "contas_receber", "movimentacoes_estoque", "itens_venda", "vendas", "produtos", "categorias", "funcionarios", "clientes", "sessoes", "tokens_recuperacao", "limites_tentativa", "usuarios", "tentativas_pin" RESTART IDENTITY CASCADE'
  );
}

async function entrarComo(email: string) {
  const r = await autenticar({ email, senha: SENHA, ip: "10.0.0.1" });
  if (!r.ok) throw new Error("login de teste falhou");
  ambiente.cookies.set(COOKIE_SESSAO, r.token);
}

beforeEach(async () => {
  await limparTudo();
  ambiente.cookies.clear();
  ambiente.cabecalhos.clear();
  ambiente.cabecalhos.set("x-real-ip", "203.0.113.7");

  ids.admin = (await criarUsuario({ nome: "Admin", email: "admin@loja.com", senha: SENHA, papel: "admin" })).id;
  ids.operador = (await criarUsuario({ nome: "Operador", email: "op@loja.com", senha: SENHA, papel: "operador" })).id;

  const categoria = await prisma.categoria.create({ data: { nome: "Bebidas" } });
  ids.produto = (await prisma.produto.create({ data: { nome: "Água 500ml", categoria_id: categoria.id, preco_venda: 10, preco_custo: 4 } })).id;

  const f = async (nome: string, cargo: string, pin: string, extras: Record<string, unknown> = {}) =>
    (await prisma.funcionario.create({ data: { nome, cargo, pin_hash: await gerarHashPin(pin), ...extras } })).id;
  ids.frentista = await f("Ana Frentista", "frentista", "1111");
  ids.gerente = await f("Gil Gerente", "gerente", "4321");
  ids.estoquista = await f("Eva Estoque", "estoquista", "2222");
  ids.inativo = await f("Ivo Inativo", "caixa", "3333", { ativo: false });
  ids.cliente = (await prisma.cliente.create({ data: { nome: "Cliente Fiado" } })).id;
  await prisma.movimentacaoEstoque.create({ data: { produto_id: ids.produto, tipo: "entrada", quantidade: 1000, funcionario_id: ids.gerente } });
});

afterAll(async () => {
  await limparTudo();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type Operacao<T extends OperacaoCaixa["tipo"]> = Extract<OperacaoCaixa, { tipo: T }>;

function op<T extends OperacaoCaixa["tipo"]>(
  tipo: T,
  id: string,
  funcionario: string,
  dados: Operacao<T>["dados"],
  extras: { origem?: "online" | "offline"; dispositivo?: string } = {}
): Operacao<T> {
  return { tipo, id, funcionario_id: funcionario, dispositivo: extras.dispositivo ?? TERMINAL, origem: extras.origem ?? "online", dados } as Operacao<T>;
}

const enviar = (o: OperacaoCaixa) => sincronizarOperacaoCaixaAction(o);

async function abrir(opts: { id?: string; fundo?: number; funcionario?: string; terminal?: string; origem?: "online" | "offline" } = {}) {
  const id = opts.id ?? randomUUID();
  const terminal = opts.terminal ?? TERMINAL;
  const r = await enviar(
    op("abertura", id, opts.funcionario ?? ids.frentista, {
      id, terminal_id: terminal, terminal_papel: "principal", fundo_inicial_centavos: opts.fundo ?? 10000, observacoes: "Turno", aberto_em: new Date().toISOString(),
    }, { dispositivo: terminal, origem: opts.origem })
  );
  return { id, r };
}

function payload(caixaId: string, sobrescrever: Partial<PayloadVendaFila> = {}): PayloadVendaFila {
  return {
    funcionario_id: ids.frentista,
    forma_pagamento: "dinheiro",
    total: 20,
    caixa_id: caixaId,
    dispositivo: TERMINAL,
    criado_em: new Date().toISOString(),
    itens: [{ produto_id: ids.produto, quantidade: 2, preco_unitario: 10 }],
    ...sobrescrever,
  };
}

async function movimentos(caixaId: string) {
  return prisma.movimentoCaixa.findMany({ where: { caixa_id: caixaId }, orderBy: [{ ocorrido_em: "asc" }, { ordem: "asc" }] });
}

const PIN_DE = (): Record<string, string> => ({ [ids.gerente]: "4321", [ids.frentista]: "1111", [ids.estoquista]: "2222" });

/** Como o aparelho faz: o servidor valida o PIN e registra a autorização da operação ANTES da sincronização. */
async function autorizar(escopo: Parameters<typeof autorizarOperacaoCaixaAction>[0], quem: string) {
  return autorizarOperacaoCaixaAction(escopo, PIN_DE()[quem] ?? "0000");
}

async function suprimir(caixaId: string, tipo: "suprimento" | "sangria" | "despesa" | "outra_saida", valor: number, quem = ids.gerente, justificativa = "Motivo do teste", autorizado = true) {
  const id = randomUUID();
  if (autorizado && quem === ids.gerente) await autorizar({ kind: "movimento", operacao_id: id, caixa_id: caixaId, tipo, valor_centavos: valor }, quem);
  const r = await enviar(op("movimento", id, quem, { id, caixa_id: caixaId, tipo, valor_centavos: valor, justificativa, ocorrido_em: new Date().toISOString() }));
  return { id, r };
}

async function fechar(caixaId: string, conferencia: Record<string, number>, extras: { justificativa?: string; quem?: string; resumo_terminal?: unknown; origem?: "online" | "offline" } = {}) {
  return enviar(
    op("fechamento", randomUUID(), extras.quem ?? ids.frentista, {
      caixa_id: caixaId, fechado_em: new Date().toISOString(), conferencia, justificativa: extras.justificativa, resumo_terminal: extras.resumo_terminal,
    }, { origem: extras.origem })
  );
}

// ===========================================================================
describe("abertura de caixa", () => {
  it("abre com fundo inicial e registra caixa, terminal, funcionário (PIN), usuário logado, origem e hora", async () => {
    await entrarComo("op@loja.com");
    const { id, r } = await abrir({ fundo: 15000 });
    expect(r).toMatchObject({ sucesso: true, jaExistia: false });

    const c = await prisma.caixa.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({
      status: "aberto", terminal_id: TERMINAL, fundo_inicial_centavos: 15000, aberto_por_funcionario_id: ids.frentista,
      aberto_por_usuario_id: ids.operador, origem_abertura: "online",
    });
    expect(await movimentos(id)).toHaveLength(0); // o fundo NÃO é venda nem movimento

    const aud = await prisma.auditoriaCaixa.findFirstOrThrow({ where: { caixa_id: id, acao: "abertura" } });
    expect(aud).toMatchObject({ funcionario_id: ids.frentista, usuario_id: ids.operador, dispositivo: TERMINAL, origem: "online" });
  });

  it("reenvio da mesma abertura é idempotente (um só caixa, uma só auditoria)", async () => {
    await entrarComo("op@loja.com");
    const { id } = await abrir();
    const de_novo = await abrir({ id });
    expect(de_novo.r).toMatchObject({ sucesso: true, jaExistia: true });
    expect(await prisma.caixa.count()).toBe(1);
    expect(await prisma.auditoriaCaixa.count({ where: { acao: "abertura" } })).toBe(1);
  });

  it("bloqueia o segundo caixa aberto no mesmo terminal e PRESERVA a tentativa como conflito", async () => {
    await entrarComo("op@loja.com");
    await abrir();
    const segundo = await abrir();
    expect(segundo.r).toMatchObject({ sucesso: false, conflito: true });
    expect(await prisma.caixa.count({ where: { status: "aberto" } })).toBe(1);
    const conflito = await prisma.caixaConflito.findUniqueOrThrow({ where: { id: segundo.id } });
    expect(conflito).toMatchObject({ tipo: "abertura", status: "pendente" });
    expect(conflito.motivo).toMatch(/já tem um caixa aberto/);
  });

  it("terminais diferentes têm caixas independentes", async () => {
    await entrarComo("op@loja.com");
    expect((await abrir({ terminal: TERMINAL })).r.sucesso).toBe(true);
    expect((await abrir({ terminal: OUTRO_TERMINAL })).r.sucesso).toBe(true);
    expect(await prisma.caixa.count({ where: { status: "aberto" } })).toBe(2);
  });

  it("aberturas SIMULTÂNEAS no mesmo terminal: exatamente uma vence (índice único parcial)", async () => {
    await entrarComo("op@loja.com");
    const resultados = await Promise.all(Array.from({ length: 6 }, () => abrir()));
    expect(resultados.filter((x) => x.r.sucesso)).toHaveLength(1);
    expect(resultados.filter((x) => x.r.conflito)).toHaveLength(5);
    expect(await prisma.caixa.count({ where: { terminal_id: TERMINAL, status: "aberto" } })).toBe(1);
  });

  it.each([
    ["estoquista (sem permissão de vender)", () => ids.estoquista, /permissão/],
    ["funcionário inativo", () => ids.inativo, /inativo/],
    ["funcionário inexistente", () => randomUUID(), /não existe/],
  ])("%s não abre caixa (o servidor revalida o funcionário)", async (_n, quem, motivo) => {
    await entrarComo("op@loja.com");
    const { id, r } = await abrir({ funcionario: quem() });
    expect(r.sucesso).toBe(false);
    expect(r.motivo ?? r.erro).toMatch(motivo);
    expect(await prisma.caixa.count()).toBe(0);
    expect(await prisma.caixaConflito.count({ where: { id } })).toBe(1); // tentativa preservada
  });

  it("sem sessão a operação continua na fila do aparelho (requerLogin) e nada é gravado", async () => {
    const { r } = await abrir();
    expect(r).toMatchObject({ sucesso: false, requerLogin: true });
    expect(await prisma.caixa.count()).toBe(0);
  });

  it("rejeita fundo negativo/fracionado e terminal diferente do dispositivo", async () => {
    await entrarComo("op@loja.com");
    for (const fundo of [-1, 10.5]) expect((await abrir({ fundo })).r.sucesso).toBe(false);
    const id = randomUUID();
    const r = await enviar(op("abertura", id, ids.frentista, { id, terminal_id: "terminal-X", fundo_inicial_centavos: 0, aberto_em: new Date().toISOString() }));
    expect(r.sucesso).toBe(false);
    expect(await prisma.caixa.count()).toBe(0);
  });
});

// ===========================================================================
describe("vendas lançadas no caixa", () => {
  async function caixaAberto(fundo = 10000) {
    await entrarComo("op@loja.com");
    return (await abrir({ fundo })).id;
  }

  it.each(["dinheiro", "pix", "credito", "debito"] as const)("venda em %s gera um lançamento com autoria, terminal e valor em centavos", async (forma) => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    const quando = new Date(Date.now() + 30_000).toISOString(); // depois da abertura do caixa, dentro da tolerância do relógio
    expect(await sincronizarVendaAction(id, payload(caixa, { forma_pagamento: forma, criado_em: quando, origem: "offline" }))).toMatchObject({ sucesso: true });

    const [m] = await movimentos(caixa);
    expect(m).toMatchObject({
      tipo: "venda", sentido: "entrada", forma_pagamento: forma, valor_centavos: 2000, funcionario_id: ids.frentista,
      usuario_id: ids.operador, dispositivo: TERMINAL, origem: "offline", origem_operacao: "pdv", venda_id: id, ordem: 0,
    });
    expect(m.ocorrido_em.toISOString()).toBe(quando); // hora do terminal, não a do envio
  });

  it("dados do cartão (bandeira, operadora, parcelas, taxa conhecida, transação) são guardados; taxa ausente fica nula", async () => {
    const caixa = await caixaAberto();
    await sincronizarVendaAction(randomUUID(), payload(caixa, {
      forma_pagamento: "credito",
      pagamentos: [{ forma: "credito", valor_centavos: 2000, cartao: { bandeira: "Visa", adquirente: "Cielo", parcelas: 3, taxa_centavos: 70, transacao_id: "NSU-1" } }],
    }));
    await sincronizarVendaAction(randomUUID(), payload(caixa, { forma_pagamento: "debito" }));
    const [credito, debito] = await movimentos(caixa);
    expect(credito).toMatchObject({ cartao_bandeira: "Visa", cartao_adquirente: "Cielo", cartao_parcelas: 3, cartao_taxa_centavos: 70, transacao_id: "NSU-1" });
    expect(debito.cartao_taxa_centavos).toBeNull(); // nunca inventada
    const r = (await resumoDoCaixa(caixa))!;
    expect(r.por_forma.credito).toMatchObject({ saldo_centavos: 2000, taxas_conhecidas_centavos: 70, liquido_previsto_centavos: 1930 });
    expect(r.por_forma.debito.operacoes_sem_taxa).toBe(1);
  });

  it("pagamento dividido: um lançamento por forma, venda 'misto', soma conferida", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    const r = await sincronizarVendaAction(id, payload(caixa, {
      forma_pagamento: "misto",
      pagamentos: [{ forma: "dinheiro", valor_centavos: 1200 }, { forma: "pix", valor_centavos: 800 }],
    }));
    expect(r.sucesso).toBe(true);
    expect((await prisma.venda.findUniqueOrThrow({ where: { id } })).forma_pagamento).toBe("misto");
    const movs = await movimentos(caixa);
    expect(movs.map((m) => [m.forma_pagamento, m.valor_centavos, m.ordem])).toEqual([["dinheiro", 1200, 0], ["pix", 800, 1]]);
    const resumo = (await resumoDoCaixa(caixa))!;
    expect(resumo.quantidade_vendas).toBe(1);
    expect(resumo.dinheiro.saldo_esperado_centavos).toBe(11200);
  });

  it("pagamento dividido com soma diferente do total NÃO é gravado: fica retido (bloqueante), sem venda nem lançamento", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    const r = await sincronizarVendaAction(id, payload(caixa, {
      forma_pagamento: "misto",
      pagamentos: [{ forma: "dinheiro", valor_centavos: 1200 }, { forma: "pix", valor_centavos: 500 }],
    }));
    expect(r).toMatchObject({ sucesso: false, retida: "em_revisao" });
    expect(await prisma.venda.count()).toBe(0);
    expect(await movimentos(caixa)).toHaveLength(0);
    expect((await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } })).bloqueante).toBe(true);
  });

  it("fiado: lançamento 'fiado' (faturamento) sem entrar como dinheiro recebido; a conta a receber nasce só com a parcela fiada", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    await sincronizarVendaAction(id, payload(caixa, {
      forma_pagamento: "misto", cliente_id: ids.cliente,
      pagamentos: [{ forma: "dinheiro", valor_centavos: 500 }, { forma: "fiado", valor_centavos: 1500 }],
    }));
    const conta = await prisma.contaReceber.findFirstOrThrow({ where: { venda_id: id } });
    expect(Number(conta.valor_original)).toBe(15);
    const r = (await resumoDoCaixa(caixa))!;
    expect(r.total_vendas_centavos).toBe(2000);
    expect(r.total_recebido_centavos).toBe(500);
    expect(r.dinheiro.saldo_esperado_centavos).toBe(10500);
    expect(r.por_forma.fiado.saldo_centavos).toBe(1500);
  });

  it("recebimento de conta a receber entra no caixa SÓ quando recebido e há caixa aberto no terminal", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    await sincronizarVendaAction(id, payload(caixa, { forma_pagamento: "fiado", cliente_id: ids.cliente }));
    const conta = await prisma.contaReceber.findFirstOrThrow({ where: { venda_id: id } });

    // terminal sem caixa aberto: o pagamento é registrado na conta, mas não vai ao caixa
    const semCaixa = await registrarPagamento({ contaReceberId: conta.id, valor: 5, formaPagamento: "dinheiro", funcionarioId: ids.gerente, terminalId: "terminal-sem-caixa" });
    expect(semCaixa.lancadoNoCaixa).toBe(false);
    expect((await resumoDoCaixa(caixa))!.dinheiro.recebimentos_conta_centavos).toBe(0);

    const comCaixa = await registrarPagamento({ contaReceberId: conta.id, valor: 7.5, formaPagamento: "dinheiro", funcionarioId: ids.gerente, usuarioId: ids.operador, terminalId: TERMINAL });
    expect(comCaixa.lancadoNoCaixa).toBe(true);
    const mov = await prisma.movimentoCaixa.findFirstOrThrow({ where: { caixa_id: caixa, tipo: "recebimento_conta" } });
    expect(mov).toMatchObject({ valor_centavos: 750, forma_pagamento: "dinheiro", funcionario_id: ids.gerente, usuario_id: ids.operador, origem_operacao: "conta_receber" });
    const r = (await resumoDoCaixa(caixa))!;
    expect(r.dinheiro.saldo_esperado_centavos).toBe(10750);
    expect(r.total_vendas_centavos).toBe(2000); // recebimento NÃO é venda
    expect(r.total_recebido_centavos).toBe(750);
  });

  it("o aparelho consegue ler os recebimentos do SEU caixa (só do terminal dono, só com sessão, só recebimentos)", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    await sincronizarVendaAction(id, payload(caixa, { forma_pagamento: "fiado", cliente_id: ids.cliente }));
    const conta = await prisma.contaReceber.findFirstOrThrow({ where: { venda_id: id } });
    await registrarPagamento({ contaReceberId: conta.id, valor: 3.5, formaPagamento: "dinheiro", funcionarioId: ids.gerente, usuarioId: ids.operador, terminalId: TERMINAL });

    const ok = await recebimentosDoCaixaAction(caixa, TERMINAL);
    expect(ok.sucesso).toBe(true);
    expect(ok.itens).toHaveLength(1);
    expect(ok.itens[0]).toMatchObject({ forma_pagamento: "dinheiro", valor_centavos: 350, funcionario_id: ids.gerente, funcionario_nome: "Gil Gerente" });
    // outro terminal não lê o caixa deste; id inválido; sem sessão
    expect((await recebimentosDoCaixaAction(caixa, OUTRO_TERMINAL)).sucesso).toBe(false);
    expect((await recebimentosDoCaixaAction("nao-e-uuid", TERMINAL)).sucesso).toBe(false);
    ambiente.cookies.clear();
    expect(await recebimentosDoCaixaAction(caixa, TERMINAL)).toEqual({ sucesso: false, itens: [] });
  });

  describe("SEC-01: autorização da consulta de recebimentos do caixa", () => {
    const VAZIO = { sucesso: false, itens: [] };

    async function caixaComRecebimento() {
      const caixa = await caixaAberto();
      const id = randomUUID();
      await sincronizarVendaAction(id, payload(caixa, { forma_pagamento: "fiado", cliente_id: ids.cliente }));
      const conta = await prisma.contaReceber.findFirstOrThrow({ where: { venda_id: id } });
      await registrarPagamento({ contaReceberId: conta.id, valor: 4, formaPagamento: "dinheiro", funcionarioId: ids.gerente, usuarioId: ids.operador, terminalId: TERMINAL });
      return caixa;
    }

    it("quem abriu o caixa lê; administrador lê; login SEM vínculo com o caixa é recusado com a mesma resposta vazia", async () => {
      const caixa = await caixaComRecebimento();
      expect((await recebimentosDoCaixaAction(caixa, TERMINAL)).itens).toHaveLength(1);

      await criarUsuario({ nome: "Outro Operador", email: "op2@loja.com", senha: SENHA, papel: "operador" });
      await entrarComo("op2@loja.com");
      expect(await recebimentosDoCaixaAction(caixa, TERMINAL)).toEqual(VAZIO); // sem vínculo com o caixa
      expect(await recebimentosDoCaixaAction(randomUUID(), TERMINAL)).toEqual(VAZIO); // inexistente: indistinguível

      await entrarComo("admin@loja.com");
      expect((await recebimentosDoCaixaAction(caixa, TERMINAL)).itens).toHaveLength(1);
    });

    it("o vínculo vem do banco: depois de lançar um movimento no caixa, o outro login passa a ler", async () => {
      const caixa = await caixaComRecebimento();
      const op2 = await criarUsuario({ nome: "Outro Operador", email: "op2@loja.com", senha: SENHA, papel: "operador" });
      await entrarComo("op2@loja.com");
      expect(await recebimentosDoCaixaAction(caixa, TERMINAL)).toEqual(VAZIO);
      expect((await sincronizarVendaAction(randomUUID(), payload(caixa))).sucesso).toBe(true);
      expect(await prisma.movimentoCaixa.count({ where: { caixa_id: caixa, usuario_id: op2.id } })).toBeGreaterThan(0);
      expect((await recebimentosDoCaixaAction(caixa, TERMINAL)).itens).toHaveLength(1);
    });

    it("terminal diferente e caixa de OUTRO terminal são recusados (mesmo para quem opera o outro caixa)", async () => {
      const caixa = await caixaComRecebimento();
      const outro = (await abrir({ terminal: OUTRO_TERMINAL, fundo: 5000 })).id; // mesmo login operando o terminal B
      expect(await recebimentosDoCaixaAction(caixa, OUTRO_TERMINAL)).toEqual(VAZIO); // caixa A com terminal B
      expect(await recebimentosDoCaixaAction(outro, TERMINAL)).toEqual(VAZIO); // caixa B com terminal A
      expect((await recebimentosDoCaixaAction(outro, OUTRO_TERMINAL)).sucesso).toBe(true); // o par correto funciona
    });

    it("identificadores manipulados nunca vazam dados nem quebram", async () => {
      const caixa = await caixaComRecebimento();
      const hostis: [unknown, unknown][] = [
        [caixa.toUpperCase(), TERMINAL + " "],
        [`${caixa}' OR '1'='1`, TERMINAL],
        [caixa, "terminal-A' OR 1=1 --"],
        [caixa, ""],
        [caixa, "x".repeat(500)],
        ["../../etc/passwd", TERMINAL],
        [[caixa], TERMINAL],
        [{ id: caixa }, { terminal: TERMINAL }],
        [null, null],
        [undefined, undefined],
        [123, 456],
        ["00000000-0000-0000-0000-000000000000", TERMINAL],
      ];
      for (const [c, t] of hostis) {
        expect(await recebimentosDoCaixaAction(c as string, t as string)).toEqual(VAZIO);
      }
      // o par legítimo continua funcionando depois das tentativas
      expect((await recebimentosDoCaixaAction(caixa, TERMINAL)).itens).toHaveLength(1);
    });

    it("sessão inexistente, inválida ou expirada não lê nada", async () => {
      const caixa = await caixaComRecebimento();
      ambiente.cookies.set(COOKIE_SESSAO, "token-inventado");
      expect(await recebimentosDoCaixaAction(caixa, TERMINAL)).toEqual(VAZIO);

      await entrarComo("op@loja.com");
      expect((await recebimentosDoCaixaAction(caixa, TERMINAL)).sucesso).toBe(true);
      await prisma.sessao.updateMany({ data: { expira_em: new Date(Date.now() - 60_000), expira_absoluta_em: new Date(Date.now() - 60_000) } });
      expect(await recebimentosDoCaixaAction(caixa, TERMINAL)).toEqual(VAZIO);
    });

    it("a conferência do caixa continua somando os recebimentos para quem tem acesso", async () => {
      const caixa = await caixaComRecebimento();
      const lidos = await recebimentosDoCaixaAction(caixa, TERMINAL);
      expect(lidos.itens.reduce((t, i) => t + i.valor_centavos, 0)).toBe(400);
      expect((await resumoDoCaixa(caixa))!.dinheiro.recebimentos_conta_centavos).toBe(400);
    });
  });

  it("reenvio da MESMA venda (resposta perdida): um único conjunto de lançamentos", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    const p = payload(caixa);
    expect(await sincronizarVendaAction(id, p)).toMatchObject({ sucesso: true, jaExistia: false });
    expect(await sincronizarVendaAction(id, p)).toMatchObject({ sucesso: true, jaExistia: true });
    expect(await sincronizarVendaAction(id, p)).toMatchObject({ sucesso: true, jaExistia: true });
    expect(await movimentos(caixa)).toHaveLength(1);
  });

  it("envios SIMULTÂNEOS da mesma venda (dois aparelhos/retry): uma venda, um lançamento", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    const rs = await Promise.all(Array.from({ length: 6 }, () => sincronizarVendaAction(id, payload(caixa, { forma_pagamento: "misto", pagamentos: [{ forma: "dinheiro", valor_centavos: 1000 }, { forma: "pix", valor_centavos: 1000 }] }))));
    expect(rs.every((r) => r.sucesso)).toBe(true);
    expect(await prisma.venda.count()).toBe(1);
    expect(await movimentos(caixa)).toHaveLength(2); // 2 formas, sem duplicar
  });

  it("vendas distintas simultâneas: todos os lançamentos entram e o saldo fecha", async () => {
    const caixa = await caixaAberto(0);
    await Promise.all(Array.from({ length: 12 }, () => sincronizarVendaAction(randomUUID(), payload(caixa))));
    const r = (await resumoDoCaixa(caixa))!;
    expect(r.quantidade_vendas).toBe(12);
    expect(r.dinheiro.saldo_esperado_centavos).toBe(12 * 2000);
  });

  it("venda offline ANTES de a abertura chegar ao servidor: aguarda (nada gravado, nada retido) e é aceita depois", async () => {
    await entrarComo("op@loja.com");
    const caixa = randomUUID();
    const id = randomUUID();
    const r1 = await sincronizarVendaAction(id, payload(caixa));
    expect(r1).toMatchObject({ sucesso: false, aguardandoCaixa: true });
    expect(await prisma.venda.count()).toBe(0);
    expect(await prisma.vendaRevisao.count()).toBe(0);

    await abrir({ id: caixa });
    expect(await sincronizarVendaAction(id, payload(caixa))).toMatchObject({ sucesso: true });
    expect(await movimentos(caixa)).toHaveLength(1);
  });

  it("venda sem caixa, para caixa de outro terminal ou para caixa fechado fica RETIDA (nunca perdida) e não gera lançamento", async () => {
    const caixa = await caixaAberto();
    const semCaixa = await sincronizarVendaAction(randomUUID(), payload(caixa, { caixa_id: undefined }));
    expect(semCaixa).toMatchObject({ retida: "em_revisao" });
    expect(semCaixa.motivos?.join()).toMatch(/sem caixa/i);

    const outroTerminal = await sincronizarVendaAction(randomUUID(), payload(caixa, { dispositivo: OUTRO_TERMINAL }));
    expect(outroTerminal.motivos?.join()).toMatch(/outro terminal/i);

    expect((await fechar(caixa, { dinheiro_centavos: 10000 })).sucesso).toBe(true);
    const fechado = await sincronizarVendaAction(randomUUID(), payload(caixa));
    expect(fechado).toMatchObject({ sucesso: false, retida: "em_revisao" });
    expect(fechado.motivos?.join()).toMatch(/já foi fechado/);

    expect(await prisma.venda.count()).toBe(0);
    expect(await movimentos(caixa)).toHaveLength(0);
    expect(await prisma.vendaRevisao.count()).toBe(3);
  });

  it("gravação transacional: se o caixa não aceita o lançamento, a venda e a baixa de estoque são desfeitas", async () => {
    const caixa = await caixaAberto();
    await fechar(caixa, { dinheiro_centavos: 10000 });
    const id = randomUUID();
    await expect(
      registrarVenda({
        id, funcionario_id: ids.frentista, forma_pagamento: "dinheiro", dispositivo: TERMINAL, caixa_id: caixa,
        itens: [{ produto_id: ids.produto, nome: "x", quantidade: 2, preco_unitario: 10 }],
      })
    ).rejects.toThrow(/caixa/i);
    expect(await prisma.venda.count()).toBe(0);
    expect(await prisma.movimentacaoEstoque.count({ where: { tipo: "venda" } })).toBe(0);
  });

  it("aprovar venda retida num caixa já fechado é recusado com orientação (reabrir o caixa ou rejeitar)", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    await sincronizarVendaAction(id, payload(caixa, { itens: [{ produto_id: ids.produto, quantidade: 2, preco_unitario: 9 }], total: 18 })); // preço divergente
    await fechar(caixa, { dinheiro_centavos: 10000 });
    await entrarComo("admin@loja.com");
    // 1ª tentativa: os motivos mudaram desde a retenção (agora também há "caixa fechado") — o administrador revê.
    const primeira = await aprovarVendaRevisaoAction(id, "ok");
    expect(primeira.sucesso).toBe(false);
    // 2ª: com os motivos atualizados, a gravação esbarra no caixa fechado e a venda segue retida, com orientação.
    const segunda = await aprovarVendaRevisaoAction(id, "ok");
    expect(segunda.sucesso).toBe(false);
    expect(JSON.stringify(segunda)).toMatch(/caixa/i);
    expect(JSON.stringify(segunda)).toMatch(/[Rr]eabra o caixa/);
    expect(await prisma.venda.count()).toBe(0);
    expect((await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } })).status).toBe("pendente");
  });
});

// ===========================================================================
describe("suprimento, sangria, despesa e permissões", () => {
  async function caixaAberto() {
    await entrarComo("op@loja.com");
    return (await abrir({ fundo: 10000 })).id;
  }

  it("gerente registra suprimento, sangria e despesa com motivo; cada um fica com autoria do funcionário E do usuário logado", async () => {
    const caixa = await caixaAberto();
    const s = await suprimir(caixa, "suprimento", 5000, ids.gerente, "Reforço de troco");
    const g = await suprimir(caixa, "sangria", 8000, ids.gerente, "Recolhimento ao cofre");
    const d = await suprimir(caixa, "despesa", 1500, ids.gerente, "Compra de gelo");
    expect([s.r, g.r, d.r].every((x) => x.sucesso)).toBe(true);

    const movs = await movimentos(caixa);
    expect(movs.find((m) => m.id === s.id)).toMatchObject({ tipo: "suprimento", sentido: "entrada", forma_pagamento: "dinheiro", funcionario_id: ids.gerente, usuario_id: ids.operador, justificativa: "Reforço de troco" });
    expect(movs.find((m) => m.id === g.id)).toMatchObject({ tipo: "sangria", sentido: "saida" });
    expect(movs.find((m) => m.id === d.id)).toMatchObject({ tipo: "despesa", sentido: "saida" });
    expect((await resumoDoCaixa(caixa))!.dinheiro.saldo_esperado_centavos).toBe(10000 + 5000 - 8000 - 1500);
  });

  it("frentista, estoquista e funcionário inativo NÃO movimentam dinheiro (nada é gravado; tentativa preservada)", async () => {
    const caixa = await caixaAberto();
    for (const quem of [ids.frentista, ids.estoquista, ids.inativo]) {
      const { id, r } = await suprimir(caixa, "sangria", 100, quem);
      expect(r.sucesso).toBe(false);
      expect(await prisma.caixaConflito.count({ where: { id } })).toBe(1);
    }
    expect(await movimentos(caixa)).toHaveLength(0);
  });

  it("SEGURANÇA: funcionario_id de gerente enviado sem PIN validado no servidor NÃO autoriza sangria (nada gravado, tentativa preservada)", async () => {
    const caixa = await caixaAberto();
    const forjada = await suprimir(caixa, "sangria", 9000, ids.gerente, "Forjada", false);
    expect(forjada.r).toMatchObject({ sucesso: false, conflito: true });
    expect(forjada.r.motivo).toMatch(/sem autorização por PIN/);
    expect(await movimentos(caixa)).toHaveLength(0);
    expect(await prisma.caixaConflito.count({ where: { id: forjada.id } })).toBe(1);
  });

  it("SEGURANÇA: a autorização vale só para o que foi autorizado (valor, tipo, caixa, funcionário e operação)", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    const base = { id, caixa_id: caixa, tipo: "sangria" as const, valor_centavos: 100, justificativa: "Cofre", ocorrido_em: new Date().toISOString() };
    await autorizar({ kind: "movimento", operacao_id: id, caixa_id: caixa, tipo: "sangria", valor_centavos: 100 }, ids.gerente);

    // valor adulterado depois da autorização
    expect((await enviar(op("movimento", id, ids.gerente, { ...base, valor_centavos: 9000 }))).conflito).toBe(true);
    // tipo trocado
    expect((await enviar(op("movimento", id, ids.gerente, { ...base, tipo: "suprimento" }))).conflito).toBe(true);
    // outro funcionário usando a autorização do gerente
    expect((await enviar(op("movimento", id, ids.frentista, base))).conflito).toBe(true);
    expect(await movimentos(caixa)).toHaveLength(0);

    // o original, sem adulteração, passa — e o reenvio é idempotente
    expect(await enviar(op("movimento", id, ids.gerente, base))).toMatchObject({ sucesso: true, jaExistia: false });
    expect(await enviar(op("movimento", id, ids.gerente, base))).toMatchObject({ sucesso: true, jaExistia: true });
  });

  it("SEGURANÇA: a autorização é presa ao login que a obteve e expira", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    const base = { id, caixa_id: caixa, tipo: "sangria" as const, valor_centavos: 100, justificativa: "Cofre", ocorrido_em: new Date().toISOString() };
    await autorizar({ kind: "movimento", operacao_id: id, caixa_id: caixa, tipo: "sangria", valor_centavos: 100 }, ids.gerente);

    await prisma.autorizacaoCaixa.update({ where: { id }, data: { expira_em: new Date(Date.now() - 1000) } });
    expect((await enviar(op("movimento", id, ids.gerente, base))).conflito).toBe(true);

    await prisma.autorizacaoCaixa.update({ where: { id }, data: { expira_em: new Date(Date.now() + 60_000), usuario_id: ids.admin } });
    expect((await enviar(op("movimento", id, ids.gerente, base))).conflito).toBe(true); // outro login
    expect(await movimentos(caixa)).toHaveLength(0);
  });

  it("SEGURANÇA: o servidor só emite autorização para PIN de quem tem a permissão (frentista/estoquista/PIN errado, não)", async () => {
    const caixa = await caixaAberto();
    const escopo = { kind: "movimento" as const, operacao_id: randomUUID(), caixa_id: caixa, tipo: "sangria" as const, valor_centavos: 100 };
    expect((await autorizar(escopo, ids.frentista)).erroAutorizacao).toMatch(/permissão/);
    expect((await autorizar(escopo, ids.estoquista)).erroAutorizacao).toMatch(/permissão/);
    expect((await autorizarOperacaoCaixaAction(escopo, "0000")).sucesso).toBe(false);
    expect((await autorizarOperacaoCaixaAction({ ...escopo, operacao_id: "nao-e-uuid" }, "4321")).sucesso).toBe(false);
    expect(await prisma.autorizacaoCaixa.count()).toBe(0);
    // sem sessão não há autorização
    ambiente.cookies.clear();
    expect((await autorizarOperacaoCaixaAction(escopo, "4321")).sucesso).toBe(false);
  });

  it("SEGURANÇA: cancelar venda exige autorização com a permissão de cancelamento; estorno forjado é recusado", async () => {
    const caixa = await caixaAberto();
    const vendaId = randomUUID();
    await sincronizarVendaAction(vendaId, payload(caixa));
    const id = randomUUID();
    const r = await enviar(op("estorno", id, ids.gerente, { id, caixa_id: caixa, venda_id: vendaId, justificativa: "Forjado", ocorrido_em: new Date().toISOString() }));
    expect(r).toMatchObject({ sucesso: false, conflito: true });
    expect((await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } })).cancelada).toBe(false);
  });

  const dadosSangria = (id: string, caixa: string, valor = 100) => ({
    id, caixa_id: caixa, tipo: "sangria" as const, valor_centavos: valor, justificativa: "Cofre", ocorrido_em: new Date().toISOString(),
  });

  it("AUTORIZAÇÃO: validade curta (12 h) e registrada com funcionário, login, permissão e escopo", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    const antes = Date.now();
    expect((await autorizar({ kind: "movimento", operacao_id: id, caixa_id: caixa, tipo: "sangria", valor_centavos: 100 }, ids.gerente)).sucesso).toBe(true);
    const a = await prisma.autorizacaoCaixa.findUniqueOrThrow({ where: { id } });
    expect(a).toMatchObject({ funcionario_id: ids.gerente, usuario_id: ids.operador, permissao: "caixa.movimentar", consumida_em: null });
    const ms = a.expira_em.getTime() - antes;
    expect(ms).toBeGreaterThan(11 * 3600_000);
    expect(ms).toBeLessThanOrEqual(12 * 3600_000 + 5000);
  });

  it("AUTORIZAÇÃO: é CONSUMIDA junto com a operação; reenvio é idempotente e não consome nem duplica", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    await autorizar({ kind: "movimento", operacao_id: id, caixa_id: caixa, tipo: "sangria", valor_centavos: 100 }, ids.gerente);
    expect(await enviar(op("movimento", id, ids.gerente, dadosSangria(id, caixa)))).toMatchObject({ sucesso: true, jaExistia: false });
    const consumida = (await prisma.autorizacaoCaixa.findUniqueOrThrow({ where: { id } })).consumida_em;
    expect(consumida).not.toBeNull();
    // reenvio (inclusive depois de a autorização já ter expirado): resultado anterior, nada novo
    expect(await enviar(op("movimento", id, ids.gerente, dadosSangria(id, caixa)))).toMatchObject({ sucesso: true, jaExistia: true });
    expect(await movimentos(caixa)).toHaveLength(1);
    expect((await prisma.autorizacaoCaixa.findUniqueOrThrow({ where: { id } })).consumida_em).toEqual(consumida);
  });

  it("AUTORIZAÇÃO: não pode ser reaproveitada em outra operação (outro id, mesmo valor/tipo) nem renovada depois de usada", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    await autorizar({ kind: "movimento", operacao_id: id, caixa_id: caixa, tipo: "sangria", valor_centavos: 100 }, ids.gerente);
    await enviar(op("movimento", id, ids.gerente, dadosSangria(id, caixa)));

    const outro = randomUUID();
    const r = await enviar(op("movimento", outro, ids.gerente, dadosSangria(outro, caixa)));
    expect(r).toMatchObject({ sucesso: false, conflito: true });
    expect(await movimentos(caixa)).toHaveLength(1);

    // pedir o PIN de novo para a mesma operação já executada é recusado e não reabre a autorização
    const nova = await autorizar({ kind: "movimento", operacao_id: id, caixa_id: caixa, tipo: "sangria", valor_centavos: 100 }, ids.gerente);
    expect(nova.sucesso).toBe(false);
    expect((await prisma.autorizacaoCaixa.findUniqueOrThrow({ where: { id } })).consumida_em).not.toBeNull();
  });

  it("AUTORIZAÇÃO: o banco impede alterar, reabrir ou apagar uma autorização já consumida", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    await autorizar({ kind: "movimento", operacao_id: id, caixa_id: caixa, tipo: "sangria", valor_centavos: 100 }, ids.gerente);
    await enviar(op("movimento", id, ids.gerente, dadosSangria(id, caixa)));
    await expect(prisma.autorizacaoCaixa.update({ where: { id }, data: { consumida_em: null } })).rejects.toThrow(/já utilizada/);
    await expect(prisma.autorizacaoCaixa.delete({ where: { id } })).rejects.toThrow(/já utilizada/);
  });

  it("AUTORIZAÇÃO: se a operação falha (caixa fechado), a transação volta e a autorização NÃO é gasta", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    await autorizar({ kind: "movimento", operacao_id: id, caixa_id: caixa, tipo: "sangria", valor_centavos: 100 }, ids.gerente);
    expect((await fechar(caixa, { dinheiro_centavos: 10000 })).sucesso).toBe(true);
    const r = await enviar(op("movimento", id, ids.gerente, dadosSangria(id, caixa)));
    expect(r).toMatchObject({ sucesso: false, conflito: true });
    expect((await prisma.autorizacaoCaixa.findUniqueOrThrow({ where: { id } })).consumida_em).toBeNull();
    expect(await movimentos(caixa)).toHaveLength(0);
  });

  it("AUTORIZAÇÃO: não é emitida para escopo inválido nem para caixa já fechado", async () => {
    const caixa = await caixaAberto();
    const base = { kind: "movimento" as const, operacao_id: randomUUID(), caixa_id: caixa, tipo: "sangria" as const, valor_centavos: 100 };
    expect((await autorizar({ ...base, valor_centavos: -5 }, ids.gerente)).sucesso).toBe(false);
    expect((await autorizar({ ...base, valor_centavos: 1.5 }, ids.gerente)).sucesso).toBe(false);
    expect((await autorizar({ ...base, tipo: "venda" as never }, ids.gerente)).sucesso).toBe(false);
    expect((await autorizar({ kind: "estorno", operacao_id: randomUUID(), caixa_id: caixa }, ids.gerente)).sucesso).toBe(false);
    expect((await autorizar({ kind: "estorno", operacao_id: randomUUID(), caixa_id: caixa, venda_id: randomUUID(), movimento_id: randomUUID() }, ids.gerente)).sucesso).toBe(false);
    expect((await autorizar({ kind: "outro" as never, operacao_id: randomUUID(), caixa_id: caixa } as never, ids.gerente)).sucesso).toBe(false);
    expect(await prisma.autorizacaoCaixa.count()).toBe(0);
    await fechar(caixa, { dinheiro_centavos: 10000 });
    expect((await autorizar(base, ids.gerente)).sucesso).toBe(false);
    expect(await prisma.autorizacaoCaixa.count()).toBe(0);
  });

  it("AUTORIZAÇÃO: autorização do estorno é presa ao alvo — outro movimento/venda não passa", async () => {
    const caixa = await caixaAberto();
    const a = await suprimir(caixa, "despesa", 300, ids.gerente, "Gelo");
    const b = await suprimir(caixa, "despesa", 400, ids.gerente, "Luz");
    const id = randomUUID();
    await autorizar({ kind: "estorno", operacao_id: id, caixa_id: caixa, movimento_id: a.id }, ids.gerente);
    const dados = { id, caixa_id: caixa, justificativa: "Erro", ocorrido_em: new Date().toISOString() };
    expect((await enviar(op("estorno", id, ids.gerente, { ...dados, movimento_id: b.id }))).conflito).toBe(true);
    expect((await enviar(op("estorno", id, ids.gerente, { ...dados, movimento_id: a.id }))).sucesso).toBe(true);
    expect((await enviar(op("estorno", id, ids.gerente, { ...dados, movimento_id: a.id }))).jaExistia).toBe(true);
    expect((await movimentos(caixa)).filter((m) => m.tipo === "estorno")).toHaveLength(1);
  });

  it("CONCORRÊNCIA: 10 envios simultâneos da MESMA sangria geram 1 movimento e 1 consumo; todos terminam em sucesso", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    await autorizar({ kind: "movimento", operacao_id: id, caixa_id: caixa, tipo: "sangria", valor_centavos: 250 }, ids.gerente);
    const rs = await Promise.all(Array.from({ length: 10 }, () => enviar(op("movimento", id, ids.gerente, dadosSangria(id, caixa, 250)))));
    expect(rs.every((r) => r.sucesso)).toBe(true);
    expect(rs.filter((r) => !r.jaExistia)).toHaveLength(1);
    expect(await movimentos(caixa)).toHaveLength(1);
    expect(await prisma.caixaConflito.count()).toBe(0);
    expect((await prisma.autorizacaoCaixa.findUniqueOrThrow({ where: { id } })).consumida_em).not.toBeNull();
  });

  it("CONCORRÊNCIA: 10 envios simultâneos do MESMO estorno de venda estornam uma vez só", async () => {
    const caixa = await caixaAberto();
    const vendaId = randomUUID();
    await sincronizarVendaAction(vendaId, payload(caixa));
    const id = randomUUID();
    await autorizar({ kind: "estorno", operacao_id: id, caixa_id: caixa, venda_id: vendaId }, ids.gerente);
    const dados = { id, caixa_id: caixa, venda_id: vendaId, justificativa: "Desistência", ocorrido_em: new Date().toISOString() };
    const rs = await Promise.all(Array.from({ length: 10 }, () => enviar(op("estorno", id, ids.gerente, dados))));
    expect(rs.every((r) => r.sucesso)).toBe(true);
    expect(rs.filter((r) => !r.jaExistia)).toHaveLength(1);
    expect((await movimentos(caixa)).filter((m) => m.tipo === "estorno")).toHaveLength(1);
    expect((await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } })).cancelada).toBe(true);
  });

  it("CONCORRÊNCIA: duas operações DIFERENTES simultâneas com a mesma autorização — só a autorizada passa", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    const intruso = randomUUID();
    await autorizar({ kind: "movimento", operacao_id: id, caixa_id: caixa, tipo: "sangria", valor_centavos: 100 }, ids.gerente);
    const rs = await Promise.all([
      enviar(op("movimento", id, ids.gerente, dadosSangria(id, caixa))),
      enviar(op("movimento", intruso, ids.gerente, dadosSangria(intruso, caixa))),
      enviar(op("movimento", id, ids.gerente, dadosSangria(id, caixa))),
    ]);
    expect(rs[1]).toMatchObject({ sucesso: false, conflito: true });
    expect(rs[0].sucesso && rs[2].sucesso).toBe(true);
    expect(await movimentos(caixa)).toHaveLength(1);
  });

  it("CONCORRÊNCIA: autorizações de 8 sangrias distintas, enviadas juntas, são consumidas uma a uma e o saldo fecha", async () => {
    const caixa = await caixaAberto();
    const ids8 = Array.from({ length: 8 }, () => randomUUID());
    for (const i of ids8) await autorizar({ kind: "movimento", operacao_id: i, caixa_id: caixa, tipo: "sangria", valor_centavos: 100 }, ids.gerente);
    const rs = await Promise.all(ids8.map((i) => enviar(op("movimento", i, ids.gerente, dadosSangria(i, caixa)))));
    expect(rs.every((r) => r.sucesso && !r.jaExistia)).toBe(true);
    expect(await prisma.autorizacaoCaixa.count({ where: { consumida_em: { not: null } } })).toBe(8);
    expect((await movimentos(caixa)).reduce((s, m) => s + m.valor_centavos, 0)).toBe(800);
  });

  it("exige motivo e valor positivo", async () => {
    const caixa = await caixaAberto();
    expect((await suprimir(caixa, "sangria", 100, ids.gerente, "  ")).r.sucesso).toBe(false);
    expect((await suprimir(caixa, "sangria", 0)).r.sucesso).toBe(false);
    expect((await suprimir(caixa, "sangria", -50)).r.sucesso).toBe(false);
    expect(await movimentos(caixa)).toHaveLength(0);
  });

  it("reenvio da mesma sangria não duplica", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    await autorizar({ kind: "movimento", operacao_id: id, caixa_id: caixa, tipo: "sangria", valor_centavos: 700 }, ids.gerente);
    const o = op("movimento", id, ids.gerente, { id, caixa_id: caixa, tipo: "sangria", valor_centavos: 700, justificativa: "Cofre", ocorrido_em: new Date().toISOString() });
    expect(await enviar(o)).toMatchObject({ sucesso: true, jaExistia: false });
    expect(await enviar(o)).toMatchObject({ sucesso: true, jaExistia: true });
    expect(await movimentos(caixa)).toHaveLength(1);
  });

  it("movimentações SIMULTÂNEAS no mesmo caixa: todas entram, nenhuma se perde, o saldo fecha", async () => {
    const caixa = await caixaAberto();
    await Promise.all([
      ...Array.from({ length: 8 }, () => suprimir(caixa, "suprimento", 100)),
      ...Array.from({ length: 8 }, () => suprimir(caixa, "sangria", 50)),
      ...Array.from({ length: 4 }, () => sincronizarVendaAction(randomUUID(), payload(caixa))),
    ]);
    expect(await movimentos(caixa)).toHaveLength(8 + 8 + 4);
    expect((await resumoDoCaixa(caixa))!.dinheiro.saldo_esperado_centavos).toBe(10000 + 800 - 400 + 4 * 2000);
  });

  it("movimento para caixa de OUTRO terminal é recusado", async () => {
    const caixa = await caixaAberto();
    const id = randomUUID();
    const r = await enviar(op("movimento", id, ids.gerente, { id, caixa_id: caixa, tipo: "sangria", valor_centavos: 100, justificativa: "x y z", ocorrido_em: new Date().toISOString() }, { dispositivo: OUTRO_TERMINAL }));
    expect(r).toMatchObject({ sucesso: false, conflito: true });
    expect(await movimentos(caixa)).toHaveLength(0);
  });

  it("movimento para caixa que ainda não foi sincronizado aguarda (não é erro nem conflito)", async () => {
    await entrarComo("op@loja.com");
    const { r } = await suprimir(randomUUID(), "suprimento", 100);
    expect(r).toMatchObject({ sucesso: false, aguardando: true });
    expect(await prisma.caixaConflito.count()).toBe(0);
  });

  it("o banco recusa 'sangria' em Pix/cartão e movimento avulso sem explicação (regras CHECK)", async () => {
    const caixa = await caixaAberto();
    const base = { id: randomUUID(), caixa_id: caixa, tipo: "sangria", sentido: "saida", valor_centavos: 100, funcionario_id: ids.gerente, dispositivo: TERMINAL, origem: "online", origem_operacao: "caixa", ocorrido_em: new Date(), justificativa: "ok" };
    await expect(prisma.movimentoCaixa.create({ data: { ...base, forma_pagamento: "pix" } })).rejects.toThrow();
    await expect(prisma.movimentoCaixa.create({ data: { ...base, id: randomUUID(), forma_pagamento: "dinheiro", justificativa: null } })).rejects.toThrow();
    await expect(prisma.movimentoCaixa.create({ data: { ...base, id: randomUUID(), forma_pagamento: "dinheiro", valor_centavos: 0 } })).rejects.toThrow();
  });
});

// ===========================================================================
describe("cancelamento e estorno", () => {
  async function comVenda() {
    await entrarComo("op@loja.com");
    const caixa = (await abrir({ fundo: 10000 })).id;
    const vendaId = randomUUID();
    await sincronizarVendaAction(vendaId, payload(caixa, { forma_pagamento: "misto", pagamentos: [{ forma: "dinheiro", valor_centavos: 1200 }, { forma: "pix", valor_centavos: 800 }] }));
    return { caixa, vendaId };
  }
  const estorno = async (caixa: string, quem: string, dados: { venda_id?: string; movimento_id?: string }, id = randomUUID()) => {
    if (quem === ids.gerente) await autorizar({ kind: "estorno", operacao_id: id, caixa_id: caixa, ...dados }, quem);
    return enviar(op("estorno", id, quem, { id, caixa_id: caixa, justificativa: "Cliente desistiu", ocorrido_em: new Date().toISOString(), ...dados }));
  };

  it("cancelar a venda gera um estorno por forma, marca a venda como cancelada e devolve o saldo — o original é preservado", async () => {
    const { caixa, vendaId } = await comVenda();
    const r = await estorno(caixa, ids.gerente, { venda_id: vendaId });
    expect(r.sucesso).toBe(true);

    const movs = await movimentos(caixa);
    const originais = movs.filter((m) => m.tipo === "venda");
    const estornos = movs.filter((m) => m.tipo === "estorno");
    expect(originais).toHaveLength(2);
    expect(estornos.map((e) => [e.forma_pagamento, e.valor_centavos, e.sentido]).sort()).toEqual([["dinheiro", 1200, "saida"], ["pix", 800, "saida"]]);
    expect(estornos.every((e) => originais.some((o) => o.id === e.estorno_de_id))).toBe(true);
    expect((await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } })).cancelada).toBe(true);
    const resumo = (await resumoDoCaixa(caixa))!;
    expect(resumo.total_vendas_centavos).toBe(0);
    expect(resumo.dinheiro.saldo_esperado_centavos).toBe(10000);
    expect(await prisma.auditoriaCaixa.count({ where: { caixa_id: caixa, acao: "estorno" } })).toBe(1);
  });

  it("só quem tem permissão de cancelar (gerente/proprietário) estorna venda; frentista não", async () => {
    const { caixa, vendaId } = await comVenda();
    const r = await estorno(caixa, ids.frentista, { venda_id: vendaId });
    expect(r.sucesso).toBe(false);
    expect((await movimentos(caixa)).filter((m) => m.tipo === "estorno")).toHaveLength(0);
    expect((await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } })).cancelada).toBe(false);
  });

  it("não estorna duas vezes (operações diferentes) e o reenvio da mesma operação é idempotente", async () => {
    const { caixa, vendaId } = await comVenda();
    const id = randomUUID();
    expect(await estorno(caixa, ids.gerente, { venda_id: vendaId }, id)).toMatchObject({ sucesso: true, jaExistia: false });
    expect(await estorno(caixa, ids.gerente, { venda_id: vendaId }, id)).toMatchObject({ sucesso: true, jaExistia: true });
    const outra = await estorno(caixa, ids.gerente, { venda_id: vendaId });
    expect(outra).toMatchObject({ sucesso: false, conflito: true });
    expect((await movimentos(caixa)).filter((m) => m.tipo === "estorno")).toHaveLength(2);
  });

  it("corrigir uma sangria = estorno (registro novo); o valor original nunca é alterado", async () => {
    const { caixa } = await comVenda();
    const sangria = await suprimir(caixa, "sangria", 3000);
    expect((await estorno(caixa, ids.gerente, { movimento_id: sangria.id })).sucesso).toBe(true);
    const original = await prisma.movimentoCaixa.findUniqueOrThrow({ where: { id: sangria.id } });
    expect(original.valor_centavos).toBe(3000);
    expect((await resumoDoCaixa(caixa))!.dinheiro.saldo_esperado_centavos).toBe(10000 + 1200);
  });

  it("estorno de um estorno e estorno de venda com fiado são recusados", async () => {
    const { caixa, vendaId } = await comVenda();
    await estorno(caixa, ids.gerente, { venda_id: vendaId });
    const est = await prisma.movimentoCaixa.findFirstOrThrow({ where: { caixa_id: caixa, tipo: "estorno" } });
    expect((await estorno(caixa, ids.gerente, { movimento_id: est.id })).sucesso).toBe(false);

    const fiado = randomUUID();
    await sincronizarVendaAction(fiado, payload(caixa, { forma_pagamento: "fiado", cliente_id: ids.cliente }));
    expect((await estorno(caixa, ids.gerente, { venda_id: fiado })).sucesso).toBe(false);
  });

  it("estorno de venda PARCIALMENTE fiado (dinheiro + fiado) é recusado: nada cancelado, conta a receber e autorização intactas", async () => {
    const caixa = (await (async () => { await entrarComo("op@loja.com"); return abrir({ fundo: 10000 }); })()).id;
    const vendaId = randomUUID();
    await sincronizarVendaAction(vendaId, payload(caixa, {
      forma_pagamento: "misto", total: 20, cliente_id: ids.cliente,
      pagamentos: [{ forma: "dinheiro", valor_centavos: 500 }, { forma: "fiado", valor_centavos: 1500 }],
    }));
    const antes = await prisma.contaReceber.findFirstOrThrow({ where: { venda_id: vendaId } });
    const r = await estorno(caixa, ids.gerente, { venda_id: vendaId });
    expect(r).toMatchObject({ sucesso: false, conflito: true });
    expect(r.motivo).toMatch(/fiado/);
    expect((await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } })).cancelada).toBe(false);
    expect((await movimentos(caixa)).filter((m) => m.tipo === "estorno")).toHaveLength(0);
    const depois = await prisma.contaReceber.findUniqueOrThrow({ where: { id: antes.id } });
    expect(Number(depois.saldo_atual)).toBe(Number(antes.saldo_atual));
    expect((await prisma.autorizacaoCaixa.findFirstOrThrow({ orderBy: { created_at: "desc" } })).consumida_em).toBeNull();
    // estoque: a recusa não mexe em estoque (e o estorno financeiro nunca devolve estoque)
    expect(await prisma.movimentacaoEstoque.count({ where: { venda_id: vendaId, tipo: "entrada" } })).toBe(0);
  });

  const ultimaAutorizacao = () => prisma.autorizacaoCaixa.findFirstOrThrow({ orderBy: { created_at: "desc" } });

  it("SEC-01: estorno AVULSO (movimento_id) de lançamento de VENDA é recusado no servidor; venda, estoque e autorização intactos", async () => {
    const { caixa, vendaId } = await comVenda();
    const lancamento = (await movimentos(caixa)).find((m) => m.tipo === "venda")!;
    const estoqueAntes = await prisma.movimentacaoEstoque.count({ where: { venda_id: vendaId } });
    const movsAntes = (await movimentos(caixa)).length;

    const r = await estorno(caixa, ids.gerente, { movimento_id: lancamento.id });
    expect(r).toMatchObject({ sucesso: false, conflito: true });
    expect(r.motivo).toMatch(/venda/i);

    expect((await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } })).cancelada).toBe(false);
    expect(await movimentos(caixa)).toHaveLength(movsAntes);
    expect((await movimentos(caixa)).filter((m) => m.tipo === "estorno")).toHaveLength(0);
    expect(await prisma.movimentacaoEstoque.count({ where: { venda_id: vendaId } })).toBe(estoqueAntes);
    expect(await prisma.movimentacaoEstoque.count({ where: { venda_id: vendaId, tipo: "entrada" } })).toBe(0);
    expect((await ultimaAutorizacao()).consumida_em).toBeNull(); // recusa NÃO consome a autorização
    expect(await prisma.auditoriaCaixa.count({ where: { caixa_id: caixa, acao: "estorno" } })).toBe(0);
    // a recusa fica preservada como conflito para o administrador (a operação não é descartada)
    expect(await prisma.caixaConflito.count({ where: { tipo: "estorno", caixa_id: caixa } })).toBe(1);
    // e o fluxo PRÓPRIO de cancelamento da venda continua funcionando
    expect((await estorno(caixa, ids.gerente, { venda_id: vendaId })).sucesso).toBe(true);
  });

  it("SEC-01: estorno AVULSO de RECEBIMENTO de conta a receber é recusado; conta, saldo, caixa e autorização intactos", async () => {
    const caixa = (await (async () => { await entrarComo("op@loja.com"); return abrir({ fundo: 10000 }); })()).id;
    const fiado = randomUUID();
    await sincronizarVendaAction(fiado, payload(caixa, { forma_pagamento: "fiado", cliente_id: ids.cliente }));
    const conta = await prisma.contaReceber.findFirstOrThrow({ where: { venda_id: fiado } });
    await registrarPagamento({ contaReceberId: conta.id, valor: 6, formaPagamento: "dinheiro", funcionarioId: ids.gerente, usuarioId: ids.operador, terminalId: TERMINAL });
    const recebimento = await prisma.movimentoCaixa.findFirstOrThrow({ where: { caixa_id: caixa, tipo: "recebimento_conta" } });
    const contaAntes = await prisma.contaReceber.findUniqueOrThrow({ where: { id: conta.id } });
    const recebimentosAntes = await prisma.recebimento.count();
    const saldoAntes = (await resumoDoCaixa(caixa))!.dinheiro.saldo_esperado_centavos;

    const r = await estorno(caixa, ids.gerente, { movimento_id: recebimento.id });
    expect(r).toMatchObject({ sucesso: false, conflito: true });
    expect(r.motivo).toMatch(/recebimento|conta a receber/i);

    const contaDepois = await prisma.contaReceber.findUniqueOrThrow({ where: { id: conta.id } });
    expect(Number(contaDepois.saldo_atual)).toBe(Number(contaAntes.saldo_atual));
    expect(contaDepois.status).toBe(contaAntes.status);
    expect(await prisma.recebimento.count()).toBe(recebimentosAntes);
    expect((await movimentos(caixa)).filter((m) => m.tipo === "estorno")).toHaveLength(0);
    expect((await resumoDoCaixa(caixa))!.dinheiro.saldo_esperado_centavos).toBe(saldoAntes);
    expect((await prisma.venda.findUniqueOrThrow({ where: { id: fiado } })).cancelada).toBe(false);
    expect((await ultimaAutorizacao()).consumida_em).toBeNull();
  });

  it("SEC-01: estorno ADMINISTRATIVO de movimento avulso (sangria/suprimento) segue permitido e não toca em venda, estoque nem recebíveis", async () => {
    const { caixa, vendaId } = await comVenda();
    const sangria = await suprimir(caixa, "sangria", 2500);
    const estoqueAntes = await prisma.movimentacaoEstoque.count();
    const contasAntes = await prisma.contaReceber.count();

    const r = await estorno(caixa, ids.gerente, { movimento_id: sangria.id });
    expect(r).toMatchObject({ sucesso: true, jaExistia: false });
    expect((await ultimaAutorizacao()).consumida_em).not.toBeNull(); // aqui a autorização É consumida
    expect((await movimentos(caixa)).filter((m) => m.tipo === "estorno")).toHaveLength(1);
    expect((await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } })).cancelada).toBe(false);
    expect(await prisma.movimentacaoEstoque.count()).toBe(estoqueAntes);
    expect(await prisma.contaReceber.count()).toBe(contasAntes);
    // reenvio da mesma operação: idempotente, sem novo lançamento
    expect(await prisma.auditoriaCaixa.count({ where: { caixa_id: caixa, acao: "estorno" } })).toBe(1);
  });

  it("estorno de lançamento de OUTRO caixa (turno anterior, já fechado) é recusado com motivo claro; nada muda", async () => {
    const { caixa, vendaId } = await comVenda();
    await fechar(caixa, { dinheiro_centavos: 11200, pix_centavos: 800 });
    const novo = (await abrir({ fundo: 5000 })).id;
    const r = await estorno(novo, ids.gerente, { venda_id: vendaId });
    expect(r).toMatchObject({ sucesso: false, conflito: true });
    expect(r.motivo).toMatch(/outro caixa/);
    expect((await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } })).cancelada).toBe(false);
    expect((await movimentos(novo)).filter((m) => m.tipo === "estorno")).toHaveLength(0);
    expect((await prisma.autorizacaoCaixa.findFirstOrThrow({ orderBy: { created_at: "desc" } })).consumida_em).toBeNull();
  });

  it("estorno em caixa fechado é recusado (conflito preservado)", async () => {
    const { caixa, vendaId } = await comVenda();
    await fechar(caixa, { dinheiro_centavos: 11200, pix_centavos: 800 });
    const r = await estorno(caixa, ids.gerente, { venda_id: vendaId });
    expect(r).toMatchObject({ sucesso: false, conflito: true });
    expect((await prisma.venda.findUniqueOrThrow({ where: { id: vendaId } })).cancelada).toBe(false);
  });
});

// ===========================================================================
describe("fechamento", () => {
  async function diaDeTrabalho() {
    await entrarComo("op@loja.com");
    const caixa = (await abrir({ fundo: 10000 })).id;
    await sincronizarVendaAction(randomUUID(), payload(caixa, { forma_pagamento: "dinheiro" })); // +20,00
    await sincronizarVendaAction(randomUUID(), payload(caixa, { forma_pagamento: "pix" })); // 20,00 pix
    await sincronizarVendaAction(randomUUID(), payload(caixa, { forma_pagamento: "credito", pagamentos: [{ forma: "credito", valor_centavos: 2000, cartao: { taxa_centavos: 100 } }] }));
    await sincronizarVendaAction(randomUUID(), payload(caixa, { forma_pagamento: "debito" }));
    await suprimir(caixa, "suprimento", 5000);
    await suprimir(caixa, "sangria", 8000);
    await suprimir(caixa, "despesa", 1500);
    return caixa;
  }
  const CERTO = { dinheiro_centavos: 10000 + 2000 + 5000 - 8000 - 1500, pix_centavos: 2000, credito_centavos: 2000, debito_centavos: 2000 };

  it("saldo correto: fecha sem diferença, registra quem fechou (PIN e login) e guarda o resumo oficial do servidor", async () => {
    const caixa = await diaDeTrabalho();
    const r = await fechar(caixa, CERTO, { quem: ids.frentista });
    expect(r).toMatchObject({ sucesso: true, jaExistia: false });

    const c = await prisma.caixa.findUniqueOrThrow({ where: { id: caixa } });
    expect(c).toMatchObject({
      status: "fechado", fechado_por_funcionario_id: ids.frentista, fechado_por_usuario_id: ids.operador, origem_fechamento: "online",
      diferenca_dinheiro_centavos: 0, diferenca_total_centavos: 0, conferencia_status: null,
    });
    expect(c.fechado_em).toBeTruthy();
    const oficial = (r.fechamento as { resumo: { dinheiro: { saldo_esperado_centavos: number }; total_vendas_centavos: number; por_forma: { credito: { liquido_previsto_centavos: number } } } }).resumo;
    expect(oficial.dinheiro.saldo_esperado_centavos).toBe(CERTO.dinheiro_centavos);
    expect(oficial.total_vendas_centavos).toBe(8000);
    expect(oficial.por_forma.credito.liquido_previsto_centavos).toBe(1900);
    expect(await prisma.auditoriaCaixa.count({ where: { caixa_id: caixa, acao: "fechamento" } })).toBe(1);
  });

  it("divergência: guarda diferenças, justificativa e marca a conferência como pendente (sem confirmar silenciosamente)", async () => {
    const caixa = await diaDeTrabalho();
    const r = await fechar(caixa, { ...CERTO, dinheiro_centavos: CERTO.dinheiro_centavos - 250, pix_centavos: 2100 }, { justificativa: "Troco dado a mais" });
    expect(r.sucesso).toBe(true);
    const c = await prisma.caixa.findUniqueOrThrow({ where: { id: caixa } });
    expect(c).toMatchObject({ diferenca_dinheiro_centavos: -250, diferenca_total_centavos: -150, justificativa_divergencia: "Troco dado a mais", conferencia_status: "pendente" });
  });

  it("REGRESSÃO (navegador real): o resumo devolvido ao aparelho traz 'diferencas' como LISTA por forma, não objeto", async () => {
    await entrarComo("op@loja.com");
    const caixa = (await abrir({ fundo: 10000 })).id;
    const r = await fechar(caixa, { dinheiro_centavos: 9000 }, { justificativa: "Quebra" });
    expect(r.sucesso).toBe(true);
    const f = r.fechamento as { resumo: unknown; diferencas: Array<{ forma: string; diferenca_centavos: number | null }> };
    expect(Array.isArray(f.diferencas)).toBe(true);
    expect(f.diferencas.find((d) => d.forma === "dinheiro")?.diferenca_centavos).toBe(-1000);
    const gravado = (await prisma.caixa.findUniqueOrThrow({ where: { id: caixa } })).resumo_fechamento as { diferencas: unknown };
    expect(Array.isArray(gravado.diferencas)).toBe(true);
  });

  it("o fechamento é idempotente e ignora o 2º envio (não muda quem/quando fechou)", async () => {
    const caixa = await diaDeTrabalho();
    await fechar(caixa, CERTO, { quem: ids.frentista });
    const antes = await prisma.caixa.findUniqueOrThrow({ where: { id: caixa } });
    const de_novo = await fechar(caixa, { dinheiro_centavos: 1 }, { quem: ids.gerente });
    expect(de_novo).toMatchObject({ sucesso: true, jaExistia: true });
    const depois = await prisma.caixa.findUniqueOrThrow({ where: { id: caixa } });
    expect(depois.fechado_em?.toISOString()).toBe(antes.fechado_em?.toISOString());
    expect(depois.fechado_por_funcionario_id).toBe(ids.frentista);
    expect(await prisma.auditoriaCaixa.count({ where: { caixa_id: caixa, acao: "fechamento" } })).toBe(1);
  });

  it("o servidor recalcula tudo e compara com o resumo do aparelho (aparelho desatualizado vira nota de auditoria)", async () => {
    const caixa = await diaDeTrabalho();
    const r = await fechar(caixa, CERTO, { resumo_terminal: { dinheiro: { saldo_esperado_centavos: 999 } }, origem: "offline" });
    expect(r.sucesso).toBe(true);
    const aud = await prisma.auditoriaCaixa.findFirstOrThrow({ where: { caixa_id: caixa, acao: "fechamento" } });
    expect(aud.origem).toBe("offline");
    expect((aud.detalhes as { resumo_terminal_difere: boolean }).resumo_terminal_difere).toBe(true);
    expect((aud.detalhes as { saldo_esperado_dinheiro_centavos: number }).saldo_esperado_dinheiro_centavos).toBe(CERTO.dinheiro_centavos);
  });

  it("exige o dinheiro contado e a permissão de vender do funcionário", async () => {
    const caixa = await diaDeTrabalho();
    expect((await fechar(caixa, {})).sucesso).toBe(false);
    expect((await fechar(caixa, CERTO, { quem: ids.estoquista })).sucesso).toBe(false);
    expect((await prisma.caixa.findUniqueOrThrow({ where: { id: caixa } })).status).toBe("aberto");
  });

  it("fechar caixa que ainda não foi sincronizado aguarda", async () => {
    await entrarComo("op@loja.com");
    expect(await fechar(randomUUID(), { dinheiro_centavos: 0 })).toMatchObject({ sucesso: false, aguardando: true });
  });

  it("DEPOIS do fechamento: venda fica retida, sangria vira conflito preservado, e o banco recusa inserção direta", async () => {
    const caixa = await diaDeTrabalho();
    await fechar(caixa, CERTO);
    const antes = (await movimentos(caixa)).length;

    expect((await sincronizarVendaAction(randomUUID(), payload(caixa))).retida).toBe("em_revisao");
    const sangria = await suprimir(caixa, "sangria", 100);
    expect(sangria.r).toMatchObject({ sucesso: false, conflito: true });
    expect(await prisma.caixaConflito.count({ where: { id: sangria.id, status: "pendente" } })).toBe(1);
    expect((await movimentos(caixa)).length).toBe(antes);

    await expect(
      prisma.movimentoCaixa.create({
        data: { id: randomUUID(), caixa_id: caixa, tipo: "suprimento", sentido: "entrada", forma_pagamento: "dinheiro", valor_centavos: 100, funcionario_id: ids.gerente, dispositivo: TERMINAL, origem: "online", origem_operacao: "caixa", ocorrido_em: new Date(), justificativa: "burlando" },
      })
    ).rejects.toThrow(/Caixa fechado/);
  });

  it("corrida entre venda e fechamento: o resumo oficial contém exatamente os lançamentos que entraram", async () => {
    await entrarComo("op@loja.com");
    const caixa = (await abrir({ fundo: 0 })).id;
    const vendas = Array.from({ length: 10 }, () => sincronizarVendaAction(randomUUID(), payload(caixa)));
    const fecha = fechar(caixa, { dinheiro_centavos: 0 }, { justificativa: "corrida" });
    const resultados = await Promise.all([...vendas, fecha]);
    expect(resultados.every((r) => !("erro" in r) || r.sucesso || (r as { retida?: string }).retida === "em_revisao")).toBe(true); // nenhuma virou "falha"

    const c = await prisma.caixa.findUniqueOrThrow({ where: { id: caixa } });
    expect(c.status).toBe("fechado");
    const oficial = (c.resumo_fechamento as { resumo: { quantidade_movimentos: number } }).resumo;
    expect(oficial.quantidade_movimentos).toBe((await movimentos(caixa)).length); // nada entrou depois do resumo
    const aceitas = await prisma.venda.count();
    expect(aceitas + (await prisma.vendaRevisao.count())).toBe(10); // cada venda: aceita OU retida; nenhuma perdida
  });
});

// ===========================================================================
describe("imutabilidade e auditoria", () => {
  async function caixaComMovimento() {
    await entrarComo("op@loja.com");
    const caixa = (await abrir({ fundo: 10000 })).id;
    const s = await suprimir(caixa, "suprimento", 5000);
    return { caixa, mov: s.id };
  }

  it("movimentos e auditoria não podem ser alterados nem apagados — nem por SQL direto", async () => {
    const { caixa, mov } = await caixaComMovimento();
    await expect(prisma.$executeRawUnsafe(`UPDATE movimentos_caixa SET valor_centavos = 1 WHERE id = '${mov}'`)).rejects.toThrow(/imutável/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM movimentos_caixa WHERE id = '${mov}'`)).rejects.toThrow(/imutável/);
    await expect(prisma.movimentoCaixa.update({ where: { id: mov }, data: { forma_pagamento: "pix" } })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE auditoria_caixa SET acao = 'x' WHERE caixa_id = '${caixa}'`)).rejects.toThrow(/imutável/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM auditoria_caixa WHERE caixa_id = '${caixa}'`)).rejects.toThrow(/imutável/);
    expect((await prisma.movimentoCaixa.findUniqueOrThrow({ where: { id: mov } })).valor_centavos).toBe(5000);
  });

  it("o caixa não é apagado e sua abertura (fundo, terminal, responsável) não é reescrita", async () => {
    const { caixa } = await caixaComMovimento();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM caixas WHERE id = '${caixa}'`)).rejects.toThrow(/não pode ser apagado/);
    await expect(prisma.caixa.update({ where: { id: caixa }, data: { fundo_inicial_centavos: 999999 } })).rejects.toThrow(/abertura/);
    await expect(prisma.caixa.update({ where: { id: caixa }, data: { terminal_id: "outro" } })).rejects.toThrow(/abertura/);
  });

  it("não se reabre caixa 'silenciosamente' por update direto (exige registro de reabertura)", async () => {
    const { caixa } = await caixaComMovimento();
    await fechar(caixa, { dinheiro_centavos: 15000 });
    await expect(prisma.caixa.update({ where: { id: caixa }, data: { status: "aberto" } })).rejects.toThrow(/Reabertura/);
  });

  it("apagar o login (ON DELETE SET NULL) não é bloqueado pela imutabilidade, mas preserva o registro", async () => {
    const { caixa, mov } = await caixaComMovimento();
    await prisma.usuario.delete({ where: { id: ids.operador } });
    const m = await prisma.movimentoCaixa.findUniqueOrThrow({ where: { id: mov } });
    expect(m.usuario_id).toBeNull();
    expect(m.valor_centavos).toBe(5000);
    expect(m.funcionario_id).toBe(ids.gerente); // o funcionário identificado pelo PIN permanece
    expect(await prisma.auditoriaCaixa.count({ where: { caixa_id: caixa } })).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("reabertura excepcional e conferência (administrador)", () => {
  async function caixaFechadoComDivergencia() {
    await entrarComo("op@loja.com");
    const caixa = (await abrir({ fundo: 10000 })).id;
    await sincronizarVendaAction(randomUUID(), payload(caixa));
    await fechar(caixa, { dinheiro_centavos: 11500 }, { justificativa: "Faltou troco" });
    return caixa;
  }

  it("operador comum não reabre nem consulta (papel validado no servidor)", async () => {
    const caixa = await caixaFechadoComDivergencia();
    expect((await reabrirCaixaAction(caixa, "Justificativa longa o bastante", "4321")).sucesso).toBe(false);
    await expect(listarCaixasAction({})).rejects.toThrow();
    await expect(relatorioCaixaAction({})).rejects.toThrow();
    await expect(detalheCaixaAction(caixa)).rejects.toThrow();
    await expect(listarConflitosCaixaAction("pendente")).rejects.toThrow();
    expect((await prisma.caixa.findUniqueOrThrow({ where: { id: caixa } })).status).toBe("fechado");
  });

  it("administrador sozinho NÃO basta: precisa do PIN de proprietário/gerente e de justificativa", async () => {
    const caixa = await caixaFechadoComDivergencia();
    await entrarComo("admin@loja.com");
    expect((await reabrirCaixaAction(caixa, "Justificativa longa o bastante", "9999")).sucesso).toBe(false); // PIN inexistente
    expect((await reabrirCaixaAction(caixa, "Justificativa longa o bastante", "1111")).erroAutorizacao).toMatch(/permissão/); // frentista
    expect((await reabrirCaixaAction(caixa, "curta", "4321")).sucesso).toBe(false); // justificativa insuficiente
    expect((await prisma.caixa.findUniqueOrThrow({ where: { id: caixa } })).status).toBe("fechado");
  });

  it("reabertura válida: registra quem (PIN + login) e por quê, guarda o fechamento anterior e volta a aceitar movimentos", async () => {
    const caixa = await caixaFechadoComDivergencia();
    await entrarComo("admin@loja.com");
    const r = await reabrirCaixaAction(caixa, "Venda esquecida, lançar antes de conferir", "4321");
    expect(r.sucesso).toBe(true);

    const c = await prisma.caixa.findUniqueOrThrow({ where: { id: caixa } });
    expect(c).toMatchObject({ status: "aberto", reaberturas: 1, fechado_em: null, diferenca_total_centavos: null });
    const aud = await prisma.auditoriaCaixa.findFirstOrThrow({ where: { caixa_id: caixa, acao: "reabertura" } });
    expect(aud).toMatchObject({ funcionario_id: ids.gerente, usuario_id: ids.admin });
    const det = aud.detalhes as { justificativa: string; fechamento_anterior: { diferenca_total_centavos: number; justificativa_divergencia: string } };
    expect(det.justificativa).toMatch(/Venda esquecida/);
    expect(det.fechamento_anterior).toMatchObject({ diferenca_total_centavos: -500, justificativa_divergencia: "Faltou troco" });

    // volta a aceitar movimentos e pode ser fechado de novo
    ambiente.cookies.clear();
    await entrarComo("op@loja.com");
    expect((await suprimir(caixa, "suprimento", 1000)).r.sucesso).toBe(true);
    expect((await fechar(caixa, { dinheiro_centavos: 12500 })).sucesso).toBe(true);
  });

  it("não reabre caixa que já está aberto nem quando o terminal já tem outro caixa aberto", async () => {
    const caixa = await caixaFechadoComDivergencia();
    await entrarComo("op@loja.com");
    await abrir({}); // novo caixa no mesmo terminal
    await entrarComo("admin@loja.com");
    const r = await reabrirCaixaAction(caixa, "Justificativa longa o bastante", "4321");
    expect(r.sucesso).toBe(false);
    expect(r.erro).toMatch(/outro caixa aberto/);
  });

  it("conferência do administrador: exige PIN autorizado e observação; só vale para divergência pendente", async () => {
    const caixa = await caixaFechadoComDivergencia();
    await entrarComo("admin@loja.com");
    expect((await conferirCaixaAction(caixa, "", "4321")).sucesso).toBe(false);
    expect((await conferirCaixaAction(caixa, "Conferido com o cofre", "1111")).sucesso).toBe(false); // frentista
    expect((await conferirCaixaAction(caixa, "Conferido com o cofre", "4321")).sucesso).toBe(true);
    const c = await prisma.caixa.findUniqueOrThrow({ where: { id: caixa } });
    expect(c).toMatchObject({ conferencia_status: "conferido", conferido_por_usuario_id: ids.admin, conferencia_obs: "Conferido com o cofre" });
    expect((await conferirCaixaAction(caixa, "de novo", "4321")).sucesso).toBe(false);
  });

  it("administrador consulta histórico, detalhe (com auditoria), relatório e conflitos", async () => {
    const caixa = await caixaFechadoComDivergencia();
    await suprimir(caixa, "sangria", 100); // vira conflito (caixa fechado)
    await entrarComo("admin@loja.com");

    const lista = await listarCaixasAction({});
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: caixa, status: "fechado", diferenca_total_centavos: -500, aberto_por: "Ana Frentista" });

    expect((await listarCaixasAction({ somente_divergentes: true }))).toHaveLength(1);
    expect((await listarCaixasAction({ funcionario_id: ids.estoquista }))).toHaveLength(0);
    expect((await listarCaixasAction({ terminal_id: "outro" }))).toHaveLength(0);

    const det = (await detalheCaixaAction(caixa))!;
    expect(det.auditoria.map((a) => a.acao)).toEqual(["abertura", "fechamento"]);
    expect(det.auditoria[0]).toMatchObject({ funcionario_nome: "Ana Frentista", usuario_nome: "Operador" });
    expect(det.movimentos[0]).toMatchObject({ funcionario_nome: "Ana Frentista", usuario_nome: "Operador", tipo: "venda" });

    const rel = await relatorioCaixaAction({});
    expect(rel.caixas).toHaveLength(1);
    expect(rel.movimentos).toHaveLength(1);

    expect((await listarConflitosCaixaAction("pendente"))).toHaveLength(1);
  });
});
