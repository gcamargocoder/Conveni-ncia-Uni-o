import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getOfflineDB } from "../db";
import {
  abrirCaixaLocal,
  CaixaLocalError,
  estornarLocal,
  fecharCaixaLocal,
  listarMovimentosLocais,
  atualizarRecebimentosDoServidor,
  mesclarRecebimentosDoServidor,
  obterCaixaAbertoLocal,
  pendenciasDoCaixa,
  registrarMovimentoAvulsoLocal,
  resumoLocal,
  statusDoCaixaLocal,
} from "../caixa-local.service";
import { registrarVendaLocal } from "../vendas-local.service";
import type { ItemCarrinho } from "@/lib/vendas/carrinho";

const ANA = { id: "func-ana", nome: "Ana (frentista)" };
const BIA = { id: "func-bia", nome: "Bia (caixa)" };
const GIL = { id: "func-gil", nome: "Gil (gerente)" };

const itens = (preco = 10, qtd = 1): ItemCarrinho[] => [{ produto_id: "p1", nome: "Água", preco_unitario: preco, quantidade: qtd }];

async function limpar() {
  const db = getOfflineDB();
  await Promise.all([
    db.vendas_locais.clear(), db.itens_venda_locais.clear(), db.estoque_local.clear(), db.fila_sincronizacao.clear(),
    db.carrinho_local.clear(), db.auditoria_local.clear(), db.configuracoes_local.clear(),
    db.caixas_locais.clear(), db.movimentos_caixa_locais.clear(),
  ]);
  await db.estoque_local.put({ produto_id: "p1", quantidade_atual: 1000, estoque_minimo: 0, updated_at: "" });
}

beforeEach(limpar);
afterEach(() => vi.unstubAllGlobals());

const vender = (o: Partial<Parameters<typeof registrarVendaLocal>[0]> = {}, funcionario = ANA) =>
  registrarVendaLocal({ itens: itens(), formaPagamento: "dinheiro", funcionarioId: funcionario.id, funcionarioNome: funcionario.nome, ...o });

describe("consultas do caixa em transação SOMENTE LEITURA (como o useLiveQuery da tela)", () => {
  async function comoNaTela() {
    const db = getOfflineDB();
    return db.transaction("r", [db.caixas_locais, db.movimentos_caixa_locais, db.configuracoes_local, db.fila_sincronizacao, db.vendas_locais], async () => {
      const caixa = (await obterCaixaAbertoLocal()) ?? null;
      if (!caixa) return { caixa, movimentos: [], resumo: null };
      return { caixa, movimentos: await listarMovimentosLocais(caixa.id), resumo: await resumoLocal(caixa.id), pend: await pendenciasDoCaixa(caixa.id) };
    });
  }

  it("primeira carga (aparelho sem identificador): não escreve nada e não dá ReadOnlyError", async () => {
    await limpar();
    await expect(comoNaTela()).resolves.toMatchObject({ caixa: null });
    expect(await getOfflineDB().configuracoes_local.get("dispositivo_id")).toBeUndefined();
  });

  it("com caixa aberto: lê caixa, movimentos e resumo em transação de leitura", async () => {
    await limpar();
    await abrirCaixaLocal({ fundoInicialCentavos: 5000, observacoes: "", responsavel: ANA });
    const r = await comoNaTela();
    expect(r.caixa?.fundo_inicial_centavos).toBe(5000);
    expect(r.resumo).not.toBeNull();
  });
});

describe("abertura de caixa", () => {
  it("abre com fundo inicial, registra quem abriu, o terminal e a hora, e enfileira a abertura", async () => {
    const caixa = await abrirCaixaLocal({ fundoInicialCentavos: 15000, observacoes: "Turno da manhã", responsavel: ANA });

    expect(caixa).toMatchObject({
      status: "aberto",
      fundo_inicial_centavos: 15000,
      aberto_por_funcionario_id: ANA.id,
      aberto_por_funcionario_nome: ANA.nome,
      observacoes_abertura: "Turno da manhã",
      abertura_sincronizada: false,
    });
    expect(caixa.terminal_id).toBeTruthy();
    expect(Number.isNaN(Date.parse(caixa.aberto_em))).toBe(false);

    const fila = await getOfflineDB().fila_sincronizacao.get(caixa.id);
    expect(fila).toMatchObject({ tipo: "caixa_abertura", status: "pendente" });
    expect(JSON.parse(fila!.payload)).toMatchObject({ tipo: "abertura", funcionario_id: ANA.id, dispositivo: caixa.terminal_id });
  });

  it("o fundo de troco não é venda: não gera movimento nem entra nos totais", async () => {
    const caixa = await abrirCaixaLocal({ fundoInicialCentavos: 15000, responsavel: ANA });
    expect(await listarMovimentosLocais(caixa.id)).toHaveLength(0);
    const r = (await resumoLocal(caixa.id))!;
    expect(r.total_vendas_centavos).toBe(0);
    expect(r.dinheiro.saldo_esperado_centavos).toBe(15000);
  });

  it("bloqueia a abertura duplicada no mesmo terminal", async () => {
    await abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: ANA });
    await expect(abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: BIA })).rejects.toMatchObject({ codigo: "caixa_ja_aberto" });
  });

  it("aberturas SIMULTÂNEAS (duas abas): só uma vence", async () => {
    const r = await Promise.allSettled([
      abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: ANA }),
      abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: BIA }),
      abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: GIL }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await getOfflineDB().caixas_locais.count()).toBe(1);
  });

  it("recusa fundo negativo, fracionado ou absurdo", async () => {
    for (const v of [-1, 10.5, Number.NaN, 2_000_000_000]) {
      await expect(abrirCaixaLocal({ fundoInicialCentavos: v, responsavel: ANA })).rejects.toBeInstanceOf(CaixaLocalError);
    }
  });

  it("funciona sem internet e marca a origem como offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const caixa = await abrirCaixaLocal({ fundoInicialCentavos: 5000, responsavel: ANA });
    expect(caixa.origem_abertura).toBe("offline");
    expect(JSON.parse((await getOfflineDB().fila_sincronizacao.get(caixa.id))!.payload).origem).toBe("offline");
  });
});

describe("venda exige caixa aberto", () => {
  it("sem caixa aberto a venda é recusada e nada é gravado (nem fila, nem estoque)", async () => {
    const r = await vender();
    expect(r.sucesso).toBe(false);
    expect(r.erro).toMatch(/caixa/i);
    const db = getOfflineDB();
    expect(await db.vendas_locais.count()).toBe(0);
    expect(await db.fila_sincronizacao.count()).toBe(0);
    expect((await db.estoque_local.get("p1"))?.quantidade_atual).toBe(1000);
  });

  it("depois do fechamento o caixa não aceita mais vendas", async () => {
    await abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: ANA });
    await fecharCaixaLocal({ conferencia: { dinheiro_centavos: 0 }, responsavel: ANA, online: false });
    expect((await vender()).sucesso).toBe(false);
  });

  it("caixa em conflito bloqueia vendas", async () => {
    const c = await abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: ANA });
    await getOfflineDB().caixas_locais.update(c.id, { conflito: "Terminal já tem caixa aberto" });
    const r = await vender();
    expect(r.sucesso).toBe(false);
    expect(r.erro).toMatch(/conflito/i);
  });
});

describe("vendas por forma de pagamento", () => {
  beforeEach(async () => {
    await abrirCaixaLocal({ fundoInicialCentavos: 10000, responsavel: ANA });
  });

  it.each([
    ["dinheiro", "dinheiro"],
    ["pix", "pix"],
    ["credito", "credito"],
    ["debito", "debito"],
  ] as const)("venda em %s gera um lançamento com a forma e o valor em centavos", async (forma, esperada) => {
    const r = await vender({ formaPagamento: forma, itens: itens(12.5, 2) });
    expect(r.sucesso).toBe(true);
    const caixa = (await obterCaixaAbertoLocal())!;
    const movs = await listarMovimentosLocais(caixa.id);
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({
      tipo: "venda", sentido: "entrada", forma_pagamento: esperada, valor_centavos: 2500,
      funcionario_id: ANA.id, venda_id: r.vendaId, origem_operacao: "pdv", sincronizado: false,
    });
  });

  it("cartão guarda bandeira, operadora, parcelas, taxa conhecida e id da transação", async () => {
    await vender({
      pagamentos: [{ forma: "credito", valor_centavos: 1000, cartao: { bandeira: "Visa", adquirente: "Cielo", parcelas: 3, taxa_centavos: 35, transacao_id: "T-99" } }],
    });
    const [m] = await listarMovimentosLocais((await obterCaixaAbertoLocal())!.id);
    expect(m).toMatchObject({ cartao_bandeira: "Visa", cartao_adquirente: "Cielo", cartao_parcelas: 3, cartao_taxa_centavos: 35, transacao_id: "T-99" });
  });

  it("pagamento dividido gera lançamentos separados por forma e confere a soma com o total", async () => {
    const r = await vender({
      itens: itens(10, 1),
      pagamentos: [{ forma: "dinheiro", valor_centavos: 600 }, { forma: "pix", valor_centavos: 400 }],
    });
    expect(r.sucesso).toBe(true);
    const movs = await listarMovimentosLocais((await obterCaixaAbertoLocal())!.id);
    expect(movs.map((m) => [m.forma_pagamento, m.valor_centavos, m.ordem])).toEqual([["dinheiro", 600, 0], ["pix", 400, 1]]);
    expect(new Set(movs.map((m) => m.venda_id)).size).toBe(1);

    const venda = await getOfflineDB().vendas_locais.get(r.vendaId!);
    expect(venda?.forma_pagamento).toBe("misto");
    const fila = JSON.parse((await getOfflineDB().fila_sincronizacao.get(r.vendaId!))!.payload);
    expect(fila).toMatchObject({ forma_pagamento: "misto", caixa_id: (await obterCaixaAbertoLocal())!.id });
    expect(fila.pagamentos).toHaveLength(2);
  });

  it("pagamento dividido cuja soma não fecha o total é recusado e nada é gravado", async () => {
    const r = await vender({ itens: itens(10, 1), pagamentos: [{ forma: "dinheiro", valor_centavos: 600 }, { forma: "pix", valor_centavos: 300 }] });
    expect(r.sucesso).toBe(false);
    expect(await getOfflineDB().vendas_locais.count()).toBe(0);
    expect(await getOfflineDB().movimentos_caixa_locais.count()).toBe(0);
  });

  it("fiado entra como faturamento, mas NÃO como dinheiro recebido", async () => {
    await vender({ formaPagamento: "fiado", clienteId: "cli-1", itens: itens(40, 1) });
    await vender({ formaPagamento: "dinheiro", itens: itens(10, 1) });
    const r = (await resumoLocal((await obterCaixaAbertoLocal())!.id))!;
    expect(r.total_vendas_centavos).toBe(5000);
    expect(r.total_recebido_centavos).toBe(1000);
    expect(r.dinheiro.saldo_esperado_centavos).toBe(11000);
  });

  it("fiado sem cliente continua sendo recusado", async () => {
    expect((await vender({ formaPagamento: "fiado" })).sucesso).toBe(false);
  });

  it("a venda e seus lançamentos são gravados juntos: falha no meio não deixa lançamento órfão", async () => {
    const db = getOfflineDB();
    const original = db.fila_sincronizacao.put.bind(db.fila_sincronizacao);
    vi.spyOn(db.fila_sincronizacao, "put").mockRejectedValueOnce(new Error("falha simulada"));
    const r = await vender();
    expect(r.sucesso).toBe(false);
    expect(await db.vendas_locais.count()).toBe(0);
    expect(await db.movimentos_caixa_locais.count()).toBe(0);
    void original;
  });
});

describe("suprimento, sangria e despesa", () => {
  beforeEach(async () => {
    await abrirCaixaLocal({ fundoInicialCentavos: 10000, responsavel: ANA });
  });

  it("suprimento aumenta o dinheiro esperado e guarda motivo e responsável", async () => {
    const m = await registrarMovimentoAvulsoLocal({ tipo: "suprimento", valorCentavos: 5000, justificativa: "Troco extra", responsavel: GIL });
    expect(m).toMatchObject({ tipo: "suprimento", sentido: "entrada", forma_pagamento: "dinheiro", funcionario_id: GIL.id, justificativa: "Troco extra" });
    expect((await resumoLocal(m.caixa_id))!.dinheiro.saldo_esperado_centavos).toBe(15000);
  });

  it("sangria reduz o dinheiro esperado", async () => {
    const m = await registrarMovimentoAvulsoLocal({ tipo: "sangria", valorCentavos: 4000, justificativa: "Recolhimento ao cofre", responsavel: GIL });
    expect(m.sentido).toBe("saida");
    expect((await resumoLocal(m.caixa_id))!.dinheiro.saldo_esperado_centavos).toBe(6000);
  });

  it("despesa paga pelo caixa entra como saída em dinheiro, em linha própria", async () => {
    const m = await registrarMovimentoAvulsoLocal({ tipo: "despesa", valorCentavos: 1500, justificativa: "Gelo", descricao: "Compra de gelo", responsavel: GIL });
    const r = (await resumoLocal(m.caixa_id))!;
    expect(r.dinheiro.despesas_centavos).toBe(1500);
    expect(r.dinheiro.saldo_esperado_centavos).toBe(8500);
  });

  it("exige motivo e valor positivo; não deixa retirar mais do que há na gaveta", async () => {
    await expect(registrarMovimentoAvulsoLocal({ tipo: "sangria", valorCentavos: 100, justificativa: "", responsavel: GIL })).rejects.toMatchObject({ codigo: "dados_invalidos" });
    await expect(registrarMovimentoAvulsoLocal({ tipo: "sangria", valorCentavos: 0, justificativa: "x y z", responsavel: GIL })).rejects.toMatchObject({ codigo: "dados_invalidos" });
    await expect(registrarMovimentoAvulsoLocal({ tipo: "sangria", valorCentavos: 10001, justificativa: "tudo", responsavel: GIL })).rejects.toMatchObject({ codigo: "dados_invalidos" });
    expect(await getOfflineDB().movimentos_caixa_locais.count()).toBe(0);
  });

  it("sem caixa aberto não há movimentação", async () => {
    await getOfflineDB().caixas_locais.clear();
    await expect(registrarMovimentoAvulsoLocal({ tipo: "suprimento", valorCentavos: 100, justificativa: "teste", responsavel: GIL })).rejects.toMatchObject({ codigo: "sem_caixa" });
  });
});

describe("autoria: vários funcionários no mesmo caixa, cada operação identificada", () => {
  it("trocar de funcionário NÃO altera a autoria das operações anteriores", async () => {
    await abrirCaixaLocal({ fundoInicialCentavos: 10000, responsavel: ANA });
    const v1 = await vender({}, ANA);
    const v2 = await vender({}, BIA);
    const sangria = await registrarMovimentoAvulsoLocal({ tipo: "sangria", valorCentavos: 500, justificativa: "Cofre", responsavel: GIL });
    const v3 = await vender({}, ANA);

    const movs = await listarMovimentosLocais((await obterCaixaAbertoLocal())!.id);
    const autor = (vendaId?: string) => movs.find((m) => m.venda_id === vendaId)?.funcionario_nome;
    expect(autor(v1.vendaId)).toBe(ANA.nome);
    expect(autor(v2.vendaId)).toBe(BIA.nome);
    expect(autor(v3.vendaId)).toBe(ANA.nome);
    expect(movs.find((m) => m.id === sangria.id)?.funcionario_id).toBe(GIL.id);
    // um único caixa (do terminal), vários responsáveis
    expect(new Set(movs.map((m) => m.caixa_id)).size).toBe(1);
    expect(new Set(movs.map((m) => m.funcionario_id)).size).toBe(3);
  });

  it("a operação na fila leva o id do funcionário identificado e NUNCA o PIN", async () => {
    await abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: ANA });
    await registrarMovimentoAvulsoLocal({ tipo: "suprimento", valorCentavos: 100, justificativa: "teste", responsavel: GIL });
    const itensFila = await getOfflineDB().fila_sincronizacao.toArray();
    const texto = itensFila.map((i) => i.payload).join("");
    expect(texto).toContain(GIL.id);
    expect(texto.toLowerCase()).not.toMatch(/pin/);
  });
});

describe("cancelamento e estorno", () => {
  beforeEach(async () => {
    await abrirCaixaLocal({ fundoInicialCentavos: 10000, responsavel: ANA });
  });

  it("cancelar uma venda gera estorno por forma, preserva o lançamento original e devolve o saldo", async () => {
    const v = await vender({ itens: itens(10, 1), pagamentos: [{ forma: "dinheiro", valor_centavos: 600 }, { forma: "pix", valor_centavos: 400 }] });
    const estornos = await estornarLocal({ vendaId: v.vendaId, justificativa: "Cliente desistiu", responsavel: GIL });

    expect(estornos.map((e) => [e.forma_pagamento, e.valor_centavos, e.sentido])).toEqual([["dinheiro", 600, "saida"], ["pix", 400, "saida"]]);
    const caixa = (await obterCaixaAbertoLocal())!;
    const movs = await listarMovimentosLocais(caixa.id);
    expect(movs.filter((m) => m.tipo === "venda")).toHaveLength(2); // originais intactos
    const r = (await resumoLocal(caixa.id))!;
    expect(r.total_vendas_centavos).toBe(0);
    expect(r.dinheiro.saldo_esperado_centavos).toBe(10000);
    expect((await getOfflineDB().vendas_locais.get(v.vendaId!))?.cancelada).toBe(true);
    expect((await getOfflineDB().fila_sincronizacao.get(estornos[0].operacao_id))?.tipo).toBe("caixa_estorno");
  });

  it("não estorna duas vezes, nem estorno de estorno, nem venda com fiado", async () => {
    const v = await vender();
    const [est] = await estornarLocal({ vendaId: v.vendaId, justificativa: "erro de digitação", responsavel: GIL });
    await expect(estornarLocal({ vendaId: v.vendaId, justificativa: "de novo", responsavel: GIL })).rejects.toMatchObject({ codigo: "nao_estornavel" });
    await expect(estornarLocal({ movimentoId: est.id, justificativa: "estornar estorno", responsavel: GIL })).rejects.toMatchObject({ codigo: "nao_estornavel" });

    const fiado = await vender({ formaPagamento: "fiado", clienteId: "c1" });
    await expect(estornarLocal({ vendaId: fiado.vendaId, justificativa: "fiado", responsavel: GIL })).rejects.toMatchObject({ codigo: "nao_estornavel" });
  });

  it("correção de uma sangria é um estorno (registro novo), nunca edição", async () => {
    const s = await registrarMovimentoAvulsoLocal({ tipo: "sangria", valorCentavos: 3000, justificativa: "Cofre", responsavel: GIL });
    await estornarLocal({ movimentoId: s.id, justificativa: "Valor lançado errado", responsavel: GIL });
    const caixa = (await obterCaixaAbertoLocal())!;
    const movs = await listarMovimentosLocais(caixa.id);
    expect(movs.find((m) => m.id === s.id)?.valor_centavos).toBe(3000); // original intacto
    expect((await resumoLocal(caixa.id))!.dinheiro.saldo_esperado_centavos).toBe(10000);
  });

  it("exige motivo", async () => {
    const v = await vender();
    await expect(estornarLocal({ vendaId: v.vendaId, justificativa: "  ", responsavel: GIL })).rejects.toMatchObject({ codigo: "dados_invalidos" });
  });
});

describe("fechamento", () => {
  beforeEach(async () => {
    await abrirCaixaLocal({ fundoInicialCentavos: 10000, responsavel: ANA });
    await vender({ formaPagamento: "dinheiro", itens: itens(20, 1) });
    await vender({ formaPagamento: "pix", itens: itens(15, 1) });
  });

  async function sincronizarTudo() {
    const db = getOfflineDB();
    await db.fila_sincronizacao.toCollection().modify({ status: "sincronizado" });
  }

  it("fechamento com saldo correto: sem diferença, exige confirmação do responsável e registra quem fechou", async () => {
    await sincronizarTudo();
    const c = await fecharCaixaLocal({ conferencia: { dinheiro_centavos: 12000, pix_centavos: 1500 }, responsavel: BIA, online: true });
    expect(c).toMatchObject({
      status: "fechado", fechado_por_funcionario_id: BIA.id, aberto_por_funcionario_id: ANA.id,
      diferenca_total_centavos: 0, justificativa_divergencia: null, origem_fechamento: "online",
    });
    expect(c.resumo_local?.dinheiro.saldo_esperado_centavos).toBe(12000);
  });

  it("fechamento com divergência exige justificativa e guarda a diferença", async () => {
    await sincronizarTudo();
    await expect(fecharCaixaLocal({ conferencia: { dinheiro_centavos: 11500, pix_centavos: 1500 }, responsavel: BIA, online: true })).rejects.toMatchObject({
      codigo: "dados_invalidos",
    });
    expect((await obterCaixaAbertoLocal())?.status).toBe("aberto"); // nada mudou

    const c = await fecharCaixaLocal({
      conferencia: { dinheiro_centavos: 11500, pix_centavos: 1500 }, justificativa: "Troco dado a mais", responsavel: BIA, online: true,
    });
    expect(c.diferenca_total_centavos).toBe(-500);
    expect(c.justificativa_divergencia).toBe("Troco dado a mais");
  });

  it("exige o dinheiro contado", async () => {
    await sincronizarTudo();
    await expect(fecharCaixaLocal({ conferencia: {}, responsavel: BIA, online: true })).rejects.toMatchObject({ codigo: "dados_invalidos" });
  });

  it("COM internet e operações pendentes, BLOQUEIA o fechamento e não altera nada", async () => {
    const antes = await pendenciasDoCaixa((await obterCaixaAbertoLocal())!.id);
    expect(antes.aguardando).toBe(3); // abertura + 2 vendas
    await expect(fecharCaixaLocal({ conferencia: { dinheiro_centavos: 12000, pix_centavos: 1500 }, responsavel: BIA, online: true })).rejects.toMatchObject({
      codigo: "pendencias_de_sincronizacao",
    });
    expect((await obterCaixaAbertoLocal())?.status).toBe("aberto");
    expect(await getOfflineDB().fila_sincronizacao.where("tipo").equals("caixa_fechamento").count()).toBe(0);
  });

  it("SEM internet fecha mesmo com pendências: fica 'pendente de sincronização' e entra na fila DEPOIS das demais operações", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const c = await fecharCaixaLocal({ conferencia: { dinheiro_centavos: 12000, pix_centavos: 1500 }, responsavel: BIA });
    expect(c.origem_fechamento).toBe("offline");
    expect(c.fechamento_confirmado_servidor).toBe(false);
    expect(statusDoCaixaLocal(c)).toBe("fechamento_pendente_sincronizacao");

    const fila = await getOfflineDB().fila_sincronizacao.orderBy("criado_em").toArray();
    expect(fila.map((i) => i.tipo)).toEqual(["caixa_abertura", "venda", "venda", "caixa_fechamento"]);
    expect(fila.every((i) => i.status === "pendente")).toBe(true); // nada foi apagado
    const op = JSON.parse(fila[3].payload);
    expect(op).toMatchObject({ tipo: "fechamento", origem: "offline", funcionario_id: BIA.id });
    expect(op.dados.resumo_terminal.dinheiro.saldo_esperado_centavos).toBe(12000);
  });

  it("depois do fechamento não há movimentação nem novo fechamento", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await fecharCaixaLocal({ conferencia: { dinheiro_centavos: 12000, pix_centavos: 1500 }, responsavel: BIA });
    await expect(registrarMovimentoAvulsoLocal({ tipo: "suprimento", valorCentavos: 100, justificativa: "tarde demais", responsavel: GIL })).rejects.toMatchObject({ codigo: "sem_caixa" });
    await expect(fecharCaixaLocal({ conferencia: { dinheiro_centavos: 0 }, responsavel: BIA })).rejects.toMatchObject({ codigo: "sem_caixa" });
  });

  it("operações retidas pelo servidor não bloqueiam o fechamento online, mas são contadas", async () => {
    const db = getOfflineDB();
    await sincronizarTudo();
    const venda = (await db.fila_sincronizacao.where("tipo").equals("venda").first())!;
    await db.fila_sincronizacao.update(venda.id, { status: "em_revisao" });
    const p = await pendenciasDoCaixa((await obterCaixaAbertoLocal())!.id);
    expect(p).toEqual({ aguardando: 0, retidas: 1 });
    const c = await fecharCaixaLocal({ conferencia: { dinheiro_centavos: 12000, pix_centavos: 1500 }, justificativa: "x", responsavel: BIA, online: true });
    expect(c.status).toBe("fechado");
  });

  it("depois de fechado, um novo caixa pode ser aberto (o anterior segue guardado)", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await fecharCaixaLocal({ conferencia: { dinheiro_centavos: 12000, pix_centavos: 1500 }, responsavel: BIA });
    const novo = await abrirCaixaLocal({ fundoInicialCentavos: 2000, responsavel: ANA });
    expect(novo.status).toBe("aberto");
    expect(await getOfflineDB().caixas_locais.count()).toBe(2);
  });
});

describe("recebimentos de contas lançados pelo servidor entram no caixa local", () => {
  const recebimento = (id: string, forma: string, valor: number) => ({
    id, forma_pagamento: forma, valor_centavos: valor, funcionario_id: "g-1", funcionario_nome: "Gil", descricao: "Recebimento de conta", ocorrido_em: new Date().toISOString(),
  });

  it("mescla como sincronizado, soma no saldo esperado em dinheiro e é idempotente (não duplica nem altera o local)", async () => {
    await limpar();
    const caixa = await abrirCaixaLocal({ fundoInicialCentavos: 10000, observacoes: "", responsavel: ANA });
    const itens = [recebimento("11111111-1111-4111-8111-111111111111", "dinheiro", 350), recebimento("22222222-2222-4222-8222-222222222222", "pix", 250)];
    expect(await mesclarRecebimentosDoServidor(caixa, itens)).toBe(2);
    expect(await mesclarRecebimentosDoServidor(caixa, itens)).toBe(0); // repetir não duplica
    const r = await resumoLocal(caixa.id);
    expect(r!.dinheiro.saldo_esperado_centavos).toBe(10350);
    expect((await listarMovimentosLocais(caixa.id)).filter((m) => m.tipo === "recebimento_conta" && m.sincronizado)).toHaveLength(2);
    // não cria operação na fila: o servidor é a origem
    expect((await getOfflineDB().fila_sincronizacao.toArray()).filter((i) => i.tipo !== "caixa_abertura")).toHaveLength(0);
  });

  it("offline ou com a abertura ainda não sincronizada, não consulta o servidor", async () => {
    await limpar();
    const caixa = await abrirCaixaLocal({ fundoInicialCentavos: 0, observacoes: "", responsavel: ANA });
    vi.stubGlobal("navigator", { onLine: false });
    expect(await atualizarRecebimentosDoServidor({ ...caixa, abertura_sincronizada: true })).toBe(0);
    vi.stubGlobal("navigator", { onLine: true });
    expect(await atualizarRecebimentosDoServidor({ ...caixa, abertura_sincronizada: false })).toBe(0);
  });
});
