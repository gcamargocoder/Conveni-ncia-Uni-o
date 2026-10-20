// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

/**
 * Integridade das vendas do PDV contra um PostgreSQL REAL de teste
 * (npm run test:integracao, exige TEST_DATABASE_URL terminado em _test).
 * Cobre: preço/quantidade adulterados, funcionário forjado/inativo/sem permissão,
 * usuário sem sessão ou sem papel, sincronização duplicada e concorrente,
 * concorrência de estoque, revisão pelo administrador e PIN fora do catálogo.
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
import { buscarAlteracoesCatalogoAction, buscarCredenciaisPinOfflineAction } from "@/lib/offline-sync/actions";
import { aprovarVendaRevisaoAction, contarVendasRevisaoAction, rejeitarVendaRevisaoAction } from "@/lib/vendas/revisao-actions";
import { finalizarVendaAction } from "@/lib/vendas/actions";
import { registrarVenda } from "@/services/vendas.service";
import { listarVendasEmRevisao } from "@/services/vendas-sincronizadas.service";

const SENHA = "Cafe-com-Leite-42";

const ids = {
  produto: "",
  caixa: "",
  gerente: "",
  estoquista: "",
  inativo: "",
  cliente: "",
  operador: "",
  admin: "",
};

async function limparTudo() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "vendas_revisao", "recebimentos", "contas_receber", "movimentacoes_estoque", "itens_venda", "vendas", "produtos", "categorias", "funcionarios", "clientes", "sessoes", "tokens_recuperacao", "limites_tentativa", "usuarios", "tentativas_pin" RESTART IDENTITY CASCADE'
  );
}

async function entrarComo(email: string) {
  const r = await autenticar({ email, senha: SENHA, ip: "10.0.0.1" });
  if (!r.ok) throw new Error("login de teste falhou");
  ambiente.cookies.set(COOKIE_SESSAO, r.token);
}

async function estoqueDe(produtoId: string): Promise<number> {
  const linhas = await prisma.$queryRaw<{ q: string }[]>`SELECT quantidade_atual::text AS q FROM estoque_atual WHERE produto_id = ${produtoId}::uuid`;
  return Number(linhas[0]?.q ?? 0);
}

function payload(sobrescrever: Partial<PayloadVendaFila> = {}): PayloadVendaFila {
  return {
    funcionario_id: ids.caixa,
    forma_pagamento: "pix",
    total: 20,
    itens: [{ produto_id: ids.produto, quantidade: 2, preco_unitario: 10 }],
    ...sobrescrever,
  };
}

const contar = {
  vendas: () => prisma.venda.count(),
  movimentosDeVenda: () => prisma.movimentacaoEstoque.count({ where: { tipo: "venda" } }),
  revisoes: () => prisma.vendaRevisao.count(),
};

beforeEach(async () => {
  await limparTudo();
  ambiente.cookies.clear();
  ambiente.cabecalhos.clear();
  ambiente.cabecalhos.set("x-real-ip", "203.0.113.7");

  const admin = await criarUsuario({ nome: "Admin", email: "admin@loja.com", senha: SENHA, papel: "admin" });
  const operador = await criarUsuario({ nome: "Operador", email: "op@loja.com", senha: SENHA, papel: "operador" });
  ids.admin = admin.id;
  ids.operador = operador.id;

  const categoria = await prisma.categoria.create({ data: { nome: "Bebidas" } });
  const produto = await prisma.produto.create({
    data: { nome: "Água 500ml", categoria_id: categoria.id, preco_venda: 10, preco_custo: 4 },
  });
  ids.produto = produto.id;

  const pin = await gerarHashPin("1234");
  const f = (nome: string, cargo: string, extras: Record<string, unknown> = {}) =>
    prisma.funcionario.create({ data: { nome, cargo, pin_hash: pin, ...extras } });
  ids.caixa = (await f("Maria Caixa", "caixa")).id;
  ids.gerente = (await f("Gil Gerente", "gerente")).id;
  ids.estoquista = (await f("Eva Estoque", "estoquista")).id;
  ids.inativo = (await f("Ivo Inativo", "caixa", { ativo: false })).id;
  await f("Rui Removido", "caixa", { deleted_at: new Date() });

  ids.cliente = (await prisma.cliente.create({ data: { nome: "Cliente Fiado" } })).id;

  // estoque inicial: 100 unidades
  await prisma.movimentacaoEstoque.create({
    data: { produto_id: ids.produto, tipo: "entrada", quantidade: 100, funcionario_id: ids.gerente },
  });
});

afterAll(async () => {
  await limparTudo();
  await prisma.$disconnect();
});

// ===========================================================================
describe("venda legítima", () => {
  it("é gravada, baixa o estoque e registra o usuário logado separado do funcionário do PDV", async () => {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    const r = await sincronizarVendaAction(id, payload());

    expect(r).toMatchObject({ sucesso: true, jaExistia: false });
    const venda = await prisma.venda.findUniqueOrThrow({ where: { id } });
    expect(venda.usuario_id).toBe(ids.operador); // quem estava logado
    expect(venda.funcionario_id).toBe(ids.caixa); // quem foi selecionado no PDV
    expect(Number(venda.total)).toBe(20);
    expect(await estoqueDe(ids.produto)).toBe(98);
  });

  it("venda fiado válida cria a conta a receber com o total recalculado", async () => {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    const r = await sincronizarVendaAction(id, payload({ forma_pagamento: "fiado", cliente_id: ids.cliente }));
    expect(r.sucesso).toBe(true);
    const conta = await prisma.contaReceber.findFirstOrThrow({ where: { venda_id: id } });
    expect(Number(conta.valor_original)).toBe(20);
  });
});

// ===========================================================================
describe("preço e quantidade adulterados", () => {
  it("preço diferente do cadastro NÃO é gravado: fica retido para revisão, com os motivos, e o estoque não muda", async () => {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    const r = await sincronizarVendaAction(id, payload({ total: 0.02, itens: [{ produto_id: ids.produto, quantidade: 2, preco_unitario: 0.01 }] }));

    expect(r.sucesso).toBe(false);
    expect(r.retida).toBe("em_revisao");
    expect(r.motivos?.join(" ")).toMatch(/difere do preço cadastrado/);
    expect(await contar.vendas()).toBe(0);
    expect(await estoqueDe(ids.produto)).toBe(100);

    const revisao = await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } });
    expect(revisao.status).toBe("pendente");
    expect(revisao.bloqueante).toBe(false);
    expect(revisao.usuario_id).toBe(ids.operador);
  });

  it("reenviar a mesma venda retida é idempotente (uma única linha de revisão)", async () => {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    const adulterada = payload({ total: 2, itens: [{ produto_id: ids.produto, quantidade: 2, preco_unitario: 1 }] });
    await sincronizarVendaAction(id, adulterada);
    const segunda = await sincronizarVendaAction(id, adulterada);
    expect(segunda.retida).toBe("em_revisao");
    expect(await contar.revisoes()).toBe(1);
  });

  it("total informado que não bate com os itens é retido", async () => {
    await entrarComo("op@loja.com");
    const r = await sincronizarVendaAction(randomUUID(), payload({ total: 1 }));
    expect(r.retida).toBe("em_revisao");
    expect(await contar.vendas()).toBe(0);
  });

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY, 0.0001])("quantidade inválida (%s) é retida como bloqueante e nunca gravada", async (quantidade) => {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    const r = await sincronizarVendaAction(id, payload({ total: 0, itens: [{ produto_id: ids.produto, quantidade, preco_unitario: 10 }] }));
    expect(r.retida).toBe("em_revisao");
    expect((await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } })).bloqueante).toBe(true);
    expect(await contar.vendas()).toBe(0);
    expect(await estoqueDe(ids.produto)).toBe(100);
  });

  it("produto inexistente é bloqueante", async () => {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    const r = await sincronizarVendaAction(id, payload({ total: 10, itens: [{ produto_id: randomUUID(), quantidade: 1, preco_unitario: 10 }] }));
    expect(r.retida).toBe("em_revisao");
    expect((await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } })).bloqueante).toBe(true);
  });

  it("identificador de venda inválido não pode nem ser retido: devolve 'invalida' e nada é gravado", async () => {
    await entrarComo("op@loja.com");
    const r = await sincronizarVendaAction("nao-e-uuid", payload());
    expect(r).toMatchObject({ sucesso: false, retida: "invalida" });
    expect(await contar.vendas()).toBe(0);
    expect(await contar.revisoes()).toBe(0);
  });
});

// ===========================================================================
describe("funcionário", () => {
  it("funcionário inexistente (id forjado) é bloqueante", async () => {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    const r = await sincronizarVendaAction(id, payload({ funcionario_id: randomUUID() }));
    expect(r.retida).toBe("em_revisao");
    expect(await contar.vendas()).toBe(0);
    expect((await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } })).bloqueante).toBe(true);
  });

  it.each([
    ["inativo", () => ids.inativo],
    ["sem permissão de vender (estoquista)", () => ids.estoquista],
  ])("funcionário %s é retido como divergência (aprovável), não gravado", async (_nome, obter) => {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    const r = await sincronizarVendaAction(id, payload({ funcionario_id: obter() }));
    expect(r.retida).toBe("em_revisao");
    expect(await contar.vendas()).toBe(0);
    expect((await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } })).bloqueante).toBe(false);
  });

  it("funcionário removido (soft delete) é retido", async () => {
    await entrarComo("op@loja.com");
    const removido = await prisma.funcionario.findFirstOrThrow({ where: { nome: "Rui Removido" } });
    const r = await sincronizarVendaAction(randomUUID(), payload({ funcionario_id: removido.id }));
    expect(r.retida).toBe("em_revisao");
  });
});

// ===========================================================================
describe("autenticação e autorização da sincronização", () => {
  it("sem sessão: exige login e não grava nem retém nada", async () => {
    const r = await sincronizarVendaAction(randomUUID(), payload());
    expect(r).toMatchObject({ sucesso: false, requerLogin: true });
    expect(await contar.vendas()).toBe(0);
    expect(await contar.revisoes()).toBe(0);
  });

  it("usuário desativado perde o direito de sincronizar", async () => {
    await entrarComo("op@loja.com");
    await prisma.usuario.update({ where: { id: ids.operador }, data: { ativo: false } });
    const r = await sincronizarVendaAction(randomUUID(), payload());
    expect(r.requerLogin).toBe(true);
    expect(await contar.vendas()).toBe(0);
  });

  it("operador NÃO pode aprovar nem rejeitar vendas retidas; só o administrador", async () => {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    await sincronizarVendaAction(id, payload({ total: 2, itens: [{ produto_id: ids.produto, quantidade: 2, preco_unitario: 1 }] }));

    expect((await aprovarVendaRevisaoAction(id)).sucesso).toBe(false);
    expect((await rejeitarVendaRevisaoAction(id)).sucesso).toBe(false);
    expect(await contar.vendas()).toBe(0);
    expect((await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } })).status).toBe("pendente");
  });

  it("anônimo não aprova nem rejeita", async () => {
    expect((await aprovarVendaRevisaoAction(randomUUID())).sucesso).toBe(false);
    expect((await rejeitarVendaRevisaoAction(randomUUID())).sucesso).toBe(false);
  });
});

// ===========================================================================
describe("revisão pelo administrador", () => {
  async function reterVendaComPrecoDiferente() {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    await sincronizarVendaAction(id, payload({ total: 18, itens: [{ produto_id: ids.produto, quantidade: 2, preco_unitario: 9 }] }));
    ambiente.cookies.clear();
    return id;
  }

  it("aprovar grava a venda com os valores informados, baixa o estoque e guarda quem enviou e quem aprovou", async () => {
    const id = await reterVendaComPrecoDiferente();
    await entrarComo("admin@loja.com");

    expect(await aprovarVendaRevisaoAction(id, "preço antigo, cliente já havia pago")).toEqual({ sucesso: true });

    const venda = await prisma.venda.findUniqueOrThrow({ where: { id } });
    expect(Number(venda.total)).toBe(18);
    expect(venda.usuario_id).toBe(ids.operador);
    expect(await estoqueDe(ids.produto)).toBe(98);
    const revisao = await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } });
    expect(revisao).toMatchObject({ status: "aprovada", decidido_por: ids.admin, observacao: "preço antigo, cliente já havia pago" });
  });

  it("aprovar duas vezes (ou em paralelo) não duplica a venda nem a baixa de estoque", async () => {
    const id = await reterVendaComPrecoDiferente();
    await entrarComo("admin@loja.com");

    const resultados = await Promise.all([aprovarVendaRevisaoAction(id), aprovarVendaRevisaoAction(id), aprovarVendaRevisaoAction(id)]);
    expect(resultados.filter((r) => r.sucesso)).toHaveLength(1);
    expect(await contar.vendas()).toBe(1);
    expect(await contar.movimentosDeVenda()).toBe(1);
    expect(await estoqueDe(ids.produto)).toBe(98);
  });

  it("depois de aprovada, o reenvio da fila local responde como já existente (sem duplicar)", async () => {
    const id = await reterVendaComPrecoDiferente();
    await entrarComo("admin@loja.com");
    await aprovarVendaRevisaoAction(id);
    const r = await sincronizarVendaAction(id, payload({ total: 18, itens: [{ produto_id: ids.produto, quantidade: 2, preco_unitario: 9 }] }));
    expect(r).toMatchObject({ sucesso: true, jaExistia: true });
    expect(await contar.vendas()).toBe(1);
  });

  it("rejeitar mantém o registro, não grava venda e o reenvio recebe 'rejeitada'", async () => {
    const id = await reterVendaComPrecoDiferente();
    await entrarComo("admin@loja.com");

    expect(await rejeitarVendaRevisaoAction(id, "preço não autorizado")).toEqual({ sucesso: true });
    expect(await contar.vendas()).toBe(0);
    expect(await estoqueDe(ids.produto)).toBe(100);
    expect(await contar.revisoes()).toBe(1);

    const r = await sincronizarVendaAction(id, payload({ total: 18, itens: [{ produto_id: ids.produto, quantidade: 2, preco_unitario: 9 }] }));
    expect(r).toMatchObject({ sucesso: false, retida: "rejeitada" });
    expect((await aprovarVendaRevisaoAction(id)).sucesso).toBe(false); // já decidida
  });

  it("venda bloqueante (dados inválidos) não pode ser aprovada nem pelo administrador", async () => {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    await sincronizarVendaAction(id, payload({ total: 0, itens: [{ produto_id: ids.produto, quantidade: -5, preco_unitario: 10 }] }));
    ambiente.cookies.clear();
    await entrarComo("admin@loja.com");

    const r = await aprovarVendaRevisaoAction(id);
    expect(r.sucesso).toBe(false);
    expect(await contar.vendas()).toBe(0);
    expect(await estoqueDe(ids.produto)).toBe(100);
  });

  it("a listagem do administrador traz motivos, preço informado e preço cadastrado", async () => {
    const id = await reterVendaComPrecoDiferente();
    const lista = await listarVendasEmRevisao("pendente");
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id, bloqueante: false, funcionario_nome: "Maria Caixa" });
    expect(lista[0].itens[0]).toMatchObject({ produto_nome: "Água 500ml", preco_informado: 9, preco_cadastrado: 10 });
  });
});

// ===========================================================================
describe("idempotência e concorrência", () => {
  it("a mesma venda enviada várias vezes grava uma só venda e uma só baixa", async () => {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    const a = await sincronizarVendaAction(id, payload());
    const b = await sincronizarVendaAction(id, payload());
    expect(a).toMatchObject({ sucesso: true, jaExistia: false });
    expect(b).toMatchObject({ sucesso: true, jaExistia: true });
    expect(await contar.vendas()).toBe(1);
    expect(await contar.movimentosDeVenda()).toBe(1);
    expect(await estoqueDe(ids.produto)).toBe(98);
  });

  it("envios SIMULTÂNEOS da mesma venda (dois aparelhos / retry) não duplicam venda, movimento nem conta", async () => {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    const p = payload({ forma_pagamento: "fiado", cliente_id: ids.cliente });
    const resultados = await Promise.all(Array.from({ length: 10 }, () => sincronizarVendaAction(id, p)));

    expect(resultados.every((r) => r.sucesso)).toBe(true);
    expect(resultados.filter((r) => r.jaExistia === false)).toHaveLength(1);
    expect(await contar.vendas()).toBe(1);
    expect(await contar.movimentosDeVenda()).toBe(1);
    expect(await prisma.contaReceber.count()).toBe(1);
    expect(await estoqueDe(ids.produto)).toBe(98);
  });

  it("vendas DISTINTAS simultâneas do mesmo produto: nenhuma baixa se perde, e o estoque pode ficar negativo (a venda nunca é bloqueada)", async () => {
    await entrarComo("op@loja.com");
    // estoque 100; 130 vendas simultâneas de 1 unidade => saldo exato de -30
    const envios = Array.from({ length: 130 }, () =>
      sincronizarVendaAction(randomUUID(), payload({ total: 10, itens: [{ produto_id: ids.produto, quantidade: 1, preco_unitario: 10 }] }))
    );
    const resultados = await Promise.all(envios);

    expect(resultados.every((r) => r.sucesso)).toBe(true);
    expect(await contar.vendas()).toBe(130);
    expect(await contar.movimentosDeVenda()).toBe(130);
    expect(await estoqueDe(ids.produto)).toBe(-30);
  }, 60000);

  it("venda que falha no meio da gravação não deixa baixa de estoque órfã (tudo na mesma transação)", async () => {
    // Chama o gravador direto (sem a validação) com um cliente inexistente: a FK da venda falha
    // depois de a transação começar. Nada pode ter ficado para trás.
    await expect(
      registrarVenda({
        id: randomUUID(),
        funcionario_id: ids.caixa,
        forma_pagamento: "fiado",
        cliente_id: randomUUID(),
        itens: [{ produto_id: ids.produto, nome: "x", quantidade: 2, preco_unitario: 10 }],
      })
    ).rejects.toThrow();
    expect(await contar.vendas()).toBe(0);
    expect(await contar.movimentosDeVenda()).toBe(0);
    expect(await estoqueDe(ids.produto)).toBe(100);
  });
});

// ===========================================================================
describe("PDV online (finalizarVendaAction)", () => {
  it("preço adulterado no carrinho online também é retido; preço correto grava e devolve o id", async () => {
    await entrarComo("op@loja.com");
    const adulterado = await finalizarVendaAction([{ produto_id: ids.produto, nome: "x", quantidade: 1, preco_unitario: 0.5 }], "pix", "1234");
    expect(adulterado.sucesso).toBe(false);
    expect(adulterado.erroGeral).toMatch(/revisão/);
    expect(await contar.vendas()).toBe(0);

    const ok = await finalizarVendaAction([{ produto_id: ids.produto, nome: "x", quantidade: 1, preco_unitario: 10 }], "pix", "1234");
    expect(ok.sucesso).toBe(true);
    const venda = await prisma.venda.findUniqueOrThrow({ where: { id: ok.vendaId! } });
    expect(venda.usuario_id).toBe(ids.operador);
  });
});

// ===========================================================================
describe("PIN fora do catálogo", () => {
  it("o catálogo sincronizado nunca contém pin_hash de ninguém", async () => {
    await entrarComo("op@loja.com");
    const catalogo = await buscarAlteracoesCatalogoAction(null);
    expect(catalogo.funcionarios.length).toBeGreaterThanOrEqual(4);
    const bruto = JSON.stringify(catalogo);
    expect(bruto).not.toContain("pin_hash");
    expect(bruto).not.toContain("$2"); // prefixo de qualquer hash bcrypt
    for (const f of catalogo.funcionarios) expect(Object.keys(f)).not.toContain("pin_hash");
  });

  it("o canal de PIN offline só traz funcionários ativos de cargos que apenas vendem (nunca gerente, estoquista, inativo ou removido)", async () => {
    await entrarComo("op@loja.com");
    const r = await buscarCredenciaisPinOfflineAction();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.credenciais.map((c) => c.funcionario_id)).toEqual([ids.caixa]);
    expect(r.credenciais[0].pin_hash).toMatch(/^\$2[aby]\$/);
  });

  it("sem sessão nem o catálogo nem os PINs offline são entregues", async () => {
    await expect(buscarAlteracoesCatalogoAction(null)).rejects.toThrow();
    expect(await buscarCredenciaisPinOfflineAction()).toMatchObject({ ok: false });
  });
});

// ===========================================================================
describe("aprovação revalida com os dados ATUAIS do banco", () => {
  async function reter(precoInformado = 9) {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    await sincronizarVendaAction(id, payload({ total: 2 * precoInformado, itens: [{ produto_id: ids.produto, quantidade: 2, preco_unitario: precoInformado }] }));
    ambiente.cookies.clear();
    await entrarComo("admin@loja.com");
    return id;
  }

  it("se o preço cadastrado mudou depois da retenção, NÃO aprova: atualiza os motivos e exige nova decisão", async () => {
    const id = await reter(9);
    await prisma.produto.update({ where: { id: ids.produto }, data: { preco_venda: 12 } });

    const primeira = await aprovarVendaRevisaoAction(id);
    expect(primeira.sucesso).toBe(false);
    expect(primeira.erro).toMatch(/mudaram/);
    expect(await contar.vendas()).toBe(0);

    const revisao = await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } });
    expect(revisao.status).toBe("pendente");
    expect(JSON.stringify(revisao.motivos)).toContain("R$ 12,00"); // administrador passa a ver o valor atual

    expect((await aprovarVendaRevisaoAction(id)).sucesso).toBe(true); // agora decidiu ciente do novo motivo
    expect(Number((await prisma.venda.findUniqueOrThrow({ where: { id } })).total)).toBe(18);
  });

  it("se o produto foi desativado depois da retenção, o novo motivo precisa ser visto antes de aprovar", async () => {
    const id = await reter(9);
    await prisma.produto.update({ where: { id: ids.produto }, data: { deleted_at: new Date() } });
    const r = await aprovarVendaRevisaoAction(id);
    expect(r.sucesso).toBe(false);
    expect(JSON.stringify((await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } })).motivos)).toContain("produto_inativo");
    expect(await contar.vendas()).toBe(0);
  });

  it("se o cliente/produto/funcionário deixou de existir, vira bloqueante e não pode mais ser aprovado", async () => {
    await entrarComo("op@loja.com");
    const id = randomUUID();
    await sincronizarVendaAction(id, payload({ funcionario_id: ids.inativo })); // divergência: funcionário inativo
    ambiente.cookies.clear();
    await entrarComo("admin@loja.com");

    await prisma.funcionario.delete({ where: { id: ids.inativo } });
    const r = await aprovarVendaRevisaoAction(id);
    expect(r.sucesso).toBe(false);
    expect(r.erro).toMatch(/não pode mais ser aprovada/);
    expect((await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } })).bloqueante).toBe(true);
    expect(await contar.vendas()).toBe(0);
  });

  it("falha DEPOIS de gravar a venda (ao marcar a revisão) desfaz TUDO: sem venda, sem baixa de estoque, pendência intacta", async () => {
    const id = await reter(9);
    await prisma.$executeRawUnsafe("CREATE OR REPLACE FUNCTION falha_teste() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falha injetada'; END; $$ LANGUAGE plpgsql");
    await prisma.$executeRawUnsafe("CREATE TRIGGER trg_falha_teste BEFORE UPDATE ON vendas_revisao FOR EACH ROW WHEN (NEW.status = 'aprovada') EXECUTE FUNCTION falha_teste()");
    try {
      const r = await aprovarVendaRevisaoAction(id);
      expect(r.sucesso).toBe(false);
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS trg_falha_teste ON vendas_revisao");
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS falha_teste()");
    }
    expect(await contar.vendas()).toBe(0);
    expect(await contar.movimentosDeVenda()).toBe(0);
    expect(await estoqueDe(ids.produto)).toBe(100);
    expect((await prisma.vendaRevisao.findUniqueOrThrow({ where: { id } })).status).toBe("pendente");

    expect((await aprovarVendaRevisaoAction(id)).sucesso).toBe(true); // e depois funciona normalmente
    expect(await contar.vendas()).toBe(1);
  });
});

// ===========================================================================
describe("indicador de vendas em revisão (contagem)", () => {
  it("administrador recebe a contagem; operador e anônimo não recebem nada", async () => {
    await entrarComo("op@loja.com");
    await sincronizarVendaAction(randomUUID(), payload({ total: 2, itens: [{ produto_id: ids.produto, quantidade: 2, preco_unitario: 1 }] }));
    await sincronizarVendaAction(randomUUID(), payload({ total: 3, itens: [{ produto_id: ids.produto, quantidade: 3, preco_unitario: 1 }] }));
    expect(await contarVendasRevisaoAction()).toEqual({ ok: false }); // operador

    ambiente.cookies.clear();
    expect(await contarVendasRevisaoAction()).toEqual({ ok: false }); // anônimo

    await entrarComo("admin@loja.com");
    expect(await contarVendasRevisaoAction()).toEqual({ ok: true, pendentes: 2 });
  });

  it("a contagem só considera pendentes (aprovadas e rejeitadas saem)", async () => {
    await entrarComo("op@loja.com");
    const a = randomUUID();
    const b = randomUUID();
    await sincronizarVendaAction(a, payload({ total: 2, itens: [{ produto_id: ids.produto, quantidade: 2, preco_unitario: 1 }] }));
    await sincronizarVendaAction(b, payload({ total: 3, itens: [{ produto_id: ids.produto, quantidade: 3, preco_unitario: 1 }] }));
    ambiente.cookies.clear();
    await entrarComo("admin@loja.com");
    await aprovarVendaRevisaoAction(a);
    expect(await contarVendasRevisaoAction()).toEqual({ ok: true, pendentes: 1 });
    await rejeitarVendaRevisaoAction(b);
    expect(await contarVendasRevisaoAction()).toEqual({ ok: true, pendentes: 0 });
  });
});
