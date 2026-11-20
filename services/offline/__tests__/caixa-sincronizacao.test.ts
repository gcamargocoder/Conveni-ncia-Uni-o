import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getOfflineDB } from "../db";
import { processarFilaSincronizacao } from "../worker-sincronizacao.service";
import {
  abrirCaixaLocal,
  fecharCaixaLocal,
  listarMovimentosLocais,
  obterCaixaAbertoLocal,
  registrarMovimentoAvulsoLocal,
  statusDoCaixaLocal,
} from "../caixa-local.service";
import { registrarVendaLocal } from "../vendas-local.service";
import type { OperacaoCaixa, ResultadoSincronizarCaixa } from "@/lib/caixa/actions";
import type { ItemCarrinho } from "@/lib/vendas/carrinho";

const ANA = { id: "func-ana", nome: "Ana" };
const GIL = { id: "func-gil", nome: "Gil" };
const itens: ItemCarrinho[] = [{ produto_id: "p1", nome: "Água", preco_unitario: 10, quantidade: 1 }];

beforeEach(async () => {
  const db = getOfflineDB();
  await Promise.all([
    db.vendas_locais.clear(), db.itens_venda_locais.clear(), db.estoque_local.clear(), db.fila_sincronizacao.clear(),
    db.carrinho_local.clear(), db.auditoria_local.clear(), db.configuracoes_local.clear(), db.logs_tecnicos.clear(),
    db.caixas_locais.clear(), db.movimentos_caixa_locais.clear(),
  ]);
  await db.estoque_local.put({ produto_id: "p1", quantidade_atual: 1000, estoque_minimo: 0, updated_at: "" });
});
afterEach(() => vi.unstubAllGlobals());

const ok: ResultadoSincronizarCaixa = { sucesso: true, jaExistia: false };
const vendaOk = () => vi.fn().mockResolvedValue({ sucesso: true });

/** Servidor falso que aplica as operações como o real: guarda o que aceitou e responde de acordo. */
function servidorFalso() {
  const recebidas: OperacaoCaixa[] = [];
  const vistos = new Set<string>();
  const enviarCaixa = vi.fn(async (op: OperacaoCaixa): Promise<ResultadoSincronizarCaixa> => {
    const jaExistia = vistos.has(op.id);
    vistos.add(op.id);
    if (!jaExistia) recebidas.push(op);
    return {
      sucesso: true,
      jaExistia,
      fechamento: op.tipo === "fechamento" ? { resumo: { dinheiro: { saldo_esperado_centavos: 12000 } }, diferencas: [] } : undefined,
    };
  });
  return { recebidas, enviarCaixa };
}

async function cenarioDoDia() {
  await abrirCaixaLocal({ fundoInicialCentavos: 10000, responsavel: ANA });
  await new Promise((r) => setTimeout(r, 3)); // ordem estável por criado_em
  const v = await registrarVendaLocal({ itens, formaPagamento: "dinheiro", funcionarioId: ANA.id, funcionarioNome: ANA.nome });
  await new Promise((r) => setTimeout(r, 3));
  await registrarMovimentoAvulsoLocal({ tipo: "suprimento", valorCentavos: 2000, justificativa: "Troco", responsavel: GIL });
  return v.vendaId!;
}

describe("sincronização do caixa — ordem e confirmação", () => {
  it("envia abertura → venda → movimento → fechamento, nessa ordem, e só então confirma o fechamento", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await cenarioDoDia();
    await new Promise((r) => setTimeout(r, 3));
    const fechado = await fecharCaixaLocal({ conferencia: { dinheiro_centavos: 13000 }, responsavel: ANA });
    expect(statusDoCaixaLocal(fechado)).toBe("fechamento_pendente_sincronizacao");
    vi.unstubAllGlobals();

    const ordem: string[] = [];
    const servidor = servidorFalso();
    const enviarCaixa = vi.fn(async (op: OperacaoCaixa) => {
      ordem.push(op.tipo);
      return servidor.enviarCaixa(op);
    });
    const enviarVenda = vi.fn(async () => {
      ordem.push("venda");
      return { sucesso: true };
    });

    const r = await processarFilaSincronizacao(enviarVenda, 5000, enviarCaixa);
    expect(ordem).toEqual(["abertura", "venda", "movimento", "fechamento"]);
    expect(r.falha).toBe(0);

    const db = getOfflineDB();
    const caixa = (await db.caixas_locais.get(fechado.id))!;
    expect(caixa.abertura_sincronizada).toBe(true);
    expect(caixa.fechamento_confirmado_servidor).toBe(true);
    expect(statusDoCaixaLocal(caixa)).toBe("fechado");
    expect((await listarMovimentosLocais(caixa.id)).every((m) => m.sincronizado)).toBe(true);
    expect((await db.fila_sincronizacao.toArray()).every((i) => i.status === "sincronizado")).toBe(true);
  });

  it("o fechamento NÃO é confirmado enquanto o servidor não responder (falha de rede mantém tudo pendente)", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await cenarioDoDia();
    const fechado = await fecharCaixaLocal({ conferencia: { dinheiro_centavos: 13000 }, responsavel: ANA });
    vi.unstubAllGlobals();

    const redeCaiu = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    const r = await processarFilaSincronizacao(vendaOk(), 5000, redeCaiu);

    expect(r.falha).toBeGreaterThan(0); // abertura e movimento falharam; o fechamento nem foi tentado
    const db = getOfflineDB();
    const caixa = (await db.caixas_locais.get(fechado.id))!;
    expect(caixa.fechamento_confirmado_servidor).toBe(false);
    expect(redeCaiu.mock.calls.some(([op]) => op.tipo === "fechamento")).toBe(false);
    expect(statusDoCaixaLocal(caixa)).toBe("fechamento_pendente_sincronizacao");
    // nenhuma operação foi apagada
    expect(await db.fila_sincronizacao.count()).toBe(4);
    expect(await db.fila_sincronizacao.where("tipo").equals("caixa_fechamento").first()).toMatchObject({ status: "pendente" });
  });

  it("recuperação após falha de rede: quando a conexão volta, tudo sai na ordem certa e sem duplicar", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await cenarioDoDia();
    const fechado = await fecharCaixaLocal({ conferencia: { dinheiro_centavos: 13000 }, responsavel: ANA });
    vi.unstubAllGlobals();

    // 1ª rodada: a abertura passa, a rede cai na venda
    const servidor = servidorFalso();
    const venda = vi.fn().mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValue({ sucesso: true });
    await processarFilaSincronizacao(venda, 5000, servidor.enviarCaixa);
    const db = getOfflineDB();
    expect((await db.caixas_locais.get(fechado.id))!.fechamento_confirmado_servidor).toBe(false);

    // o movimento e o fechamento ficaram aguardando a venda: o fechamento não passou na frente
    expect(servidor.recebidas.map((o) => o.tipo)).toEqual(["abertura", "movimento"]);

    // 2ª rodada, depois do backoff: a venda passa e libera o fechamento
    await db.fila_sincronizacao.toCollection().modify({ ultima_tentativa_em: new Date(Date.now() - 10 * 60_000).toISOString() });
    await processarFilaSincronizacao(venda, 5000, servidor.enviarCaixa);
    expect(servidor.recebidas.map((o) => o.tipo)).toEqual(["abertura", "movimento", "fechamento"]);
    expect((await db.caixas_locais.get(fechado.id))!.fechamento_confirmado_servidor).toBe(true);
  });

  it("o fechamento espera uma venda que ainda está com erro (não fecha 'por cima' de operação faltando)", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: ANA });
    await new Promise((r) => setTimeout(r, 3));
    await registrarVendaLocal({ itens, formaPagamento: "pix", funcionarioId: ANA.id, funcionarioNome: ANA.nome });
    await new Promise((r) => setTimeout(r, 3));
    await fecharCaixaLocal({ conferencia: { dinheiro_centavos: 0, pix_centavos: 1000 }, responsavel: ANA });
    vi.unstubAllGlobals();

    const servidor = servidorFalso();
    const vendaComErro = vi.fn().mockResolvedValue({ sucesso: false, erro: "500" });
    await processarFilaSincronizacao(vendaComErro, 5000, servidor.enviarCaixa);
    expect(servidor.recebidas.map((o) => o.tipo)).toEqual(["abertura"]); // fechamento NÃO foi
  });
});

describe("sincronização do caixa — idempotência", () => {
  it("reenvio duplicado: o servidor responde 'já existia' e nada se duplica nem se perde", async () => {
    await abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: ANA });
    await new Promise((r) => setTimeout(r, 3));
    await registrarMovimentoAvulsoLocal({ tipo: "suprimento", valorCentavos: 500, justificativa: "Troco", responsavel: GIL });
    const servidor = servidorFalso();

    await processarFilaSincronizacao(vendaOk(), 5000, servidor.enviarCaixa);
    // simula a resposta perdida: o aparelho acha que não enviou e envia de novo
    const db = getOfflineDB();
    await db.fila_sincronizacao.toCollection().modify({ status: "pendente", tentativas: 0, ultima_tentativa_em: null });
    const r = await processarFilaSincronizacao(vendaOk(), 5000, servidor.enviarCaixa);

    expect(servidor.recebidas).toHaveLength(2); // o servidor só "aceitou" cada operação uma vez
    expect(r.conflitosResolvidos).toBe(2);
    expect(await db.caixas_locais.count()).toBe(1);
    expect(await db.movimentos_caixa_locais.count()).toBe(1);
  });

  it("envios concorrentes do worker não reenviam o que já está sincronizado", async () => {
    await abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: ANA });
    const servidor = servidorFalso();
    await processarFilaSincronizacao(vendaOk(), 5000, servidor.enviarCaixa);
    await processarFilaSincronizacao(vendaOk(), 5000, servidor.enviarCaixa);
    expect(servidor.enviarCaixa).toHaveBeenCalledTimes(1);
  });
});

describe("sincronização do caixa — dependências e conflitos", () => {
  it("venda feita offline ANTES da abertura sincronizar: fica pendente (sem contar falha) e segue depois", async () => {
    await abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: ANA });
    await new Promise((r) => setTimeout(r, 3));
    const v = await registrarVendaLocal({ itens, formaPagamento: "dinheiro", funcionarioId: ANA.id, funcionarioNome: ANA.nome });
    const db = getOfflineDB();

    // abertura ainda não chegou ao servidor: ele responde "aguardando caixa" para a venda
    const aberturaFalha = vi.fn().mockResolvedValue({ sucesso: false, erro: "sem rede" });
    const aguardando = vi.fn().mockResolvedValue({ sucesso: false, aguardandoCaixa: true, erro: "Aguardando a sincronização do caixa desta venda." });
    const r1 = await processarFilaSincronizacao(aguardando, 5000, aberturaFalha);
    expect(r1.sucesso).toBe(0);
    const item = (await db.fila_sincronizacao.get(v.vendaId!))!;
    expect(item.status).toBe("pendente");
    expect(item.tentativas).toBe(0); // não é falha da venda
    expect(await db.vendas_locais.get(v.vendaId!)).toMatchObject({ status: "pendente_sincronizacao" });

    // abertura passa; a venda é aceita
    await db.fila_sincronizacao.toCollection().modify({ ultima_tentativa_em: null, tentativas: 0 });
    const servidor = servidorFalso();
    await processarFilaSincronizacao(vendaOk(), 5000, servidor.enviarCaixa);
    expect((await db.fila_sincronizacao.get(v.vendaId!))!.status).toBe("sincronizado");
  });

  it("conflito: o servidor preserva a operação; no aparelho ela fica visível, marca o caixa e sai do reenvio automático", async () => {
    const caixa = await abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: ANA });
    const conflito = vi.fn().mockResolvedValue({ sucesso: false, conflito: true, motivo: "Este terminal já tem um caixa aberto." });

    const r = await processarFilaSincronizacao(vendaOk(), 5000, conflito);
    expect(r.retidas).toBe(1);
    const db = getOfflineDB();
    expect(await db.fila_sincronizacao.get(caixa.id)).toMatchObject({ status: "em_revisao", erro: "Este terminal já tem um caixa aberto." });
    expect((await db.caixas_locais.get(caixa.id))!.conflito).toMatch(/já tem um caixa aberto/);

    await processarFilaSincronizacao(vendaOk(), 5000, conflito);
    expect(conflito).toHaveBeenCalledTimes(1); // não insiste
    expect(await db.fila_sincronizacao.count()).toBe(1); // nada apagado
  });

  it("sessão expirada pausa a sincronização do caixa sem perder nada", async () => {
    await abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: ANA });
    const semSessao = vi.fn().mockResolvedValue({ sucesso: false, requerLogin: true, erro: "Sua sessão expirou." });
    await processarFilaSincronizacao(vendaOk(), 5000, semSessao);
    const item = (await getOfflineDB().fila_sincronizacao.toArray())[0];
    expect(item).toMatchObject({ status: "pendente", tentativas: 0 });
  });

  it("se o aparelho foi fechado/reaberto no meio do envio, o item 'sincronizando' volta para a fila", async () => {
    const c = await abrirCaixaLocal({ fundoInicialCentavos: 0, responsavel: ANA });
    const db = getOfflineDB();
    await db.fila_sincronizacao.update(c.id, { status: "sincronizando", ultima_tentativa_em: new Date(Date.now() - 5 * 60_000).toISOString() });
    const servidor = servidorFalso();
    await processarFilaSincronizacao(vendaOk(), 5000, servidor.enviarCaixa);
    expect(servidor.recebidas).toHaveLength(1);
    expect((await obterCaixaAbertoLocal())?.abertura_sincronizada).toBe(true);
  });
});
