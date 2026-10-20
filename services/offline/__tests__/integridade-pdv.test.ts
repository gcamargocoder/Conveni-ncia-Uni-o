import { describe, it, expect, beforeEach, vi } from "vitest";
import Dexie from "dexie";
import { getOfflineDB } from "../db";
import { processarFilaSincronizacao } from "../worker-sincronizacao.service";
import { registrarVendaLocal } from "../vendas-local.service";
import { listarPendentes, listarRetidas, contarPendentes } from "../fila-sincronizacao.service";
import { substituirCredenciaisPinLocal, limparCredenciaisPinLocal } from "../credenciais-pin-local.service";
import { validarPinLocalmente } from "../pin-local.service";
import { aplicarAlteracoesCatalogoLocal } from "../sincronizacao-catalogo.service";
import { gerarHashPin } from "@/lib/auth/pin";
import type { ItemCarrinho } from "@/lib/vendas/carrinho";

const validarPinAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/actions", () => ({ validarPinAction }));

import { validarPinParaVenda } from "../pin-venda.service";

const itens: ItemCarrinho[] = [{ produto_id: "p1", nome: "Água", preco_unitario: 3, quantidade: 1 }];

async function limparBanco() {
  const db = getOfflineDB();
  await Promise.all([
    db.vendas_locais.clear(),
    db.itens_venda_locais.clear(),
    db.estoque_local.clear(),
    db.fila_sincronizacao.clear(),
    db.carrinho_local.clear(),
    db.auditoria_local.clear(),
    db.configuracoes_local.clear(),
    db.funcionarios_local.clear(),
    db.credenciais_pin_local.clear(),
  ]);
  await db.estoque_local.put({ produto_id: "p1", quantidade_atual: 1000, estoque_minimo: 0, updated_at: "" });
}

async function venda() {
  const r = await registrarVendaLocal({ itens, formaPagamento: "pix", funcionarioId: "f1", funcionarioNome: "Maria" });
  return r.vendaId!;
}

beforeEach(async () => {
  await limparBanco();
  validarPinAction.mockReset();
  Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
});

// ===========================================================================
describe("fila offline × vendas retidas pelo servidor", () => {
  it("venda retida para revisão NÃO é apagada: continua no aparelho, marcada, e sai do reenvio automático", async () => {
    const id = await venda();
    const enviar = vi.fn().mockResolvedValue({
      sucesso: false,
      retida: "em_revisao",
      erro: "Venda retida para revisão do administrador.",
      motivos: ["Preço informado R$ 3,00 difere do preço cadastrado R$ 5,00."],
    });

    const r = await processarFilaSincronizacao(enviar);

    expect(r.retidas).toBe(1);
    const item = await getOfflineDB().fila_sincronizacao.get(id);
    expect(item?.status).toBe("em_revisao");
    expect(item?.tentativas).toBe(0);
    expect(item?.erro).toContain("difere do preço cadastrado");
    expect(item?.payload).toContain('"preco_unitario":3'); // os dados da venda estão intactos
    expect((await getOfflineDB().vendas_locais.get(id))?.status).toBe("em_revisao");
    expect(await getOfflineDB().itens_venda_locais.where("venda_id").equals(id).count()).toBe(1);

    // não entra mais no ciclo de reenvio...
    expect(await contarPendentes()).toBe(0);
    await processarFilaSincronizacao(enviar);
    expect(enviar).toHaveBeenCalledTimes(1);
    // ...mas continua visível para o operador
    expect((await listarRetidas()).map((i) => i.id)).toEqual([id]);
  });

  it("venda rejeitada/inválida fica marcada como rejeitada e também é preservada", async () => {
    const id = await venda();
    await processarFilaSincronizacao(vi.fn().mockResolvedValue({ sucesso: false, retida: "rejeitada", erro: "Preço não autorizado" }));
    expect((await getOfflineDB().fila_sincronizacao.get(id))?.status).toBe("rejeitada");
    expect((await getOfflineDB().vendas_locais.get(id))?.status).toBe("rejeitada");

    const id2 = await venda();
    await processarFilaSincronizacao(vi.fn().mockResolvedValue({ sucesso: false, retida: "invalida", erro: "Venda inválida" }));
    expect((await getOfflineDB().fila_sincronizacao.get(id2))?.status).toBe("rejeitada");
    expect(await getOfflineDB().vendas_locais.count()).toBe(2);
  });

  it("uma venda retida não trava as demais: as outras continuam sincronizando", async () => {
    const retida = await venda();
    const boa = await venda();
    const enviar = vi.fn(async (id: string) =>
      id === retida ? { sucesso: false, retida: "em_revisao" as const, erro: "x" } : { sucesso: true, jaExistia: false }
    );

    const r = await processarFilaSincronizacao(enviar);

    expect(r).toMatchObject({ sucesso: 1, retidas: 1, falha: 0 });
    expect((await getOfflineDB().fila_sincronizacao.get(boa))?.status).toBe("sincronizado");
    expect((await getOfflineDB().fila_sincronizacao.get(retida))?.status).toBe("em_revisao");
  });

  it("falha comum (rede/erro do servidor) continua pendente para novo reenvio, com tentativa contada", async () => {
    const id = await venda();
    await processarFilaSincronizacao(vi.fn().mockResolvedValue({ sucesso: false, erro: "timeout" }));
    const item = await getOfflineDB().fila_sincronizacao.get(id);
    expect(item?.status).toBe("erro");
    expect(item?.tentativas).toBe(1);
    expect((await listarPendentes()).map((i) => i.id)).toContain(id);
  });

  it("sem sessão: venda segue pendente e intacta (sem tentativa, sem retenção)", async () => {
    const id = await venda();
    await processarFilaSincronizacao(vi.fn().mockResolvedValue({ sucesso: false, requerLogin: true, erro: "sessão" }));
    const item = await getOfflineDB().fila_sincronizacao.get(id);
    expect(item).toMatchObject({ status: "pendente", tentativas: 0 });
  });

  it("envio abandonado (aba fechada no meio) volta para a fila e é reenviado; envio recente em andamento não é tocado", async () => {
    const abandonada = await venda();
    const emAndamento = await venda();
    const db = getOfflineDB();
    const agora = Date.now();
    await db.fila_sincronizacao.update(abandonada, { status: "sincronizando", ultima_tentativa_em: new Date(agora - 5 * 60_000).toISOString() });
    await db.fila_sincronizacao.update(emAndamento, { status: "sincronizando", ultima_tentativa_em: new Date(agora - 5_000).toISOString() });

    const enviar = vi.fn().mockResolvedValue({ sucesso: true, jaExistia: false });
    await processarFilaSincronizacao(enviar);

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][0]).toBe(abandonada);
    expect((await db.fila_sincronizacao.get(abandonada))?.status).toBe("sincronizado");
    expect((await db.fila_sincronizacao.get(emAndamento))?.status).toBe("sincronizando");
  });

  it("envio que nunca responde expira, vira falha comum (com tentativa) e a venda continua na fila", async () => {
    const id = await venda();
    const travado = vi.fn(() => new Promise<never>(() => undefined));
    await processarFilaSincronizacao(travado, 50);
    const item = await getOfflineDB().fila_sincronizacao.get(id);
    expect(item).toMatchObject({ status: "erro", tentativas: 1 });
    expect(item?.erro).toMatch(/Tempo esgotado/);
  });

  it("a fila continua aceitando vendas offline (sem rede e sem sessão) como antes", async () => {
    const id = await venda();
    expect((await getOfflineDB().fila_sincronizacao.get(id))?.status).toBe("pendente");
    expect(await contarPendentes()).toBe(1);
  });
});

// ===========================================================================
describe("PIN offline: verificadores fora do catálogo", () => {
  it("o catálogo aplicado no aparelho nunca grava pin_hash em funcionarios_local", async () => {
    await aplicarAlteracoesCatalogoLocal({
      produtos: [],
      categorias: [],
      estoque: [],
      clientes: [],
      funcionarios: [
        { id: "f1", nome: "Maria", cargo: "caixa", ativo: true, created_at: "", updated_at: "2026-01-01T00:00:00Z", deleted_at: null },
        // mesmo que um servidor antigo/errado enviasse o campo, ele não pode ser persistido
        { id: "f2", nome: "Gil", cargo: "gerente", ativo: true, created_at: "", updated_at: "2026-01-01T00:00:00Z", deleted_at: null, pin_hash: "$2a$10$vazou" } as never,
      ],
      timestampServidor: new Date().toISOString(),
    });
    const linhas = await getOfflineDB().funcionarios_local.toArray();
    expect(linhas).toHaveLength(2);
    for (const l of linhas) expect(Object.keys(l)).not.toContain("pin_hash");
  });

  it("valida o PIN com a credencial local de quem só vende; PIN errado é recusado", async () => {
    await getOfflineDB().funcionarios_local.bulkPut([{ id: "f1", nome: "Maria", cargo: "caixa", ativo: true, updated_at: "" }]);
    await substituirCredenciaisPinLocal([{ funcionario_id: "f1", pin_hash: await gerarHashPin("1234") }]);

    expect(await validarPinLocalmente("1234")).toMatchObject({ sucesso: true, funcionario: { id: "f1", cargo: "caixa" } });
    expect(await validarPinLocalmente("9999")).toMatchObject({ sucesso: false, erro: "PIN incorreto." });
  });

  it("quem não tem credencial local (gerente, proprietário) não consegue usar PIN offline", async () => {
    await getOfflineDB().funcionarios_local.bulkPut([{ id: "g1", nome: "Gil", cargo: "gerente", ativo: true, updated_at: "" }]);
    // o servidor nunca envia o verificador do gerente: nada em credenciais_pin_local
    expect(await validarPinLocalmente("1234")).toMatchObject({ sucesso: false });
  });

  it("funcionário desativado localmente deixa de validar mesmo com credencial presente", async () => {
    await getOfflineDB().funcionarios_local.bulkPut([{ id: "f1", nome: "Maria", cargo: "caixa", ativo: false, updated_at: "" }]);
    await substituirCredenciaisPinLocal([{ funcionario_id: "f1", pin_hash: await gerarHashPin("1234") }]);
    expect((await validarPinLocalmente("1234")).sucesso).toBe(false);
  });

  it("a lista é substituída por inteiro: quem saiu da lista do servidor some do aparelho", async () => {
    const hash = await gerarHashPin("1234");
    await substituirCredenciaisPinLocal([
      { funcionario_id: "f1", pin_hash: hash },
      { funcionario_id: "f2", pin_hash: hash },
    ]);
    await substituirCredenciaisPinLocal([{ funcionario_id: "f1", pin_hash: hash }]);
    expect((await getOfflineDB().credenciais_pin_local.toArray()).map((c) => c.funcionario_id)).toEqual(["f1"]);
  });

  it("logout apaga as credenciais locais", async () => {
    await substituirCredenciaisPinLocal([{ funcionario_id: "f1", pin_hash: "x" }]);
    await limparCredenciaisPinLocal();
    expect(await getOfflineDB().credenciais_pin_local.count()).toBe(0);
  });
});

// ===========================================================================
describe("validarPinParaVenda: servidor primeiro, PIN offline como reserva", () => {
  const maria = { id: "f1", nome: "Maria", cargo: "caixa" as const };

  async function prepararPinLocal() {
    await getOfflineDB().funcionarios_local.bulkPut([{ id: "f1", nome: "Maria", cargo: "caixa", ativo: true, updated_at: "" }]);
    await substituirCredenciaisPinLocal([{ funcionario_id: "f1", pin_hash: await gerarHashPin("1234") }]);
  }

  it("online: o servidor valida (sucesso)", async () => {
    validarPinAction.mockResolvedValue({ sucesso: true, funcionario: maria });
    expect(await validarPinParaVenda("1234")).toMatchObject({ sucesso: true, funcionario: maria });
  });

  it("online: PIN incorreto no servidor é DEFINITIVO — não cai no PIN offline mesmo que o local aceitasse", async () => {
    await prepararPinLocal();
    validarPinAction.mockResolvedValue({ sucesso: false, erro: "PIN incorreto.", motivo: "pin_incorreto" });
    expect((await validarPinParaVenda("1234")).sucesso).toBe(false);
  });

  it("online: bloqueio por tentativas do servidor também é definitivo", async () => {
    await prepararPinLocal();
    validarPinAction.mockResolvedValue({ sucesso: false, erro: "Muitas tentativas.", motivo: "bloqueado" });
    expect(await validarPinParaVenda("1234")).toMatchObject({ sucesso: false, erro: "Muitas tentativas." });
  });

  it("sessão expirada no servidor: usa o PIN offline (a venda não pode ser impedida)", async () => {
    await prepararPinLocal();
    validarPinAction.mockResolvedValue({ sucesso: false, erro: "sessão", motivo: "sem_sessao" });
    expect(await validarPinParaVenda("1234")).toMatchObject({ sucesso: true, funcionario: { id: "f1" } });
  });

  it("rede cai no meio da chamada: usa o PIN offline", async () => {
    await prepararPinLocal();
    validarPinAction.mockRejectedValue(new Error("Failed to fetch"));
    expect((await validarPinParaVenda("1234")).sucesso).toBe(true);
  });

  it("sem conexão: nem chama o servidor e usa o PIN offline", async () => {
    await prepararPinLocal();
    Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
    expect((await validarPinParaVenda("1234")).sucesso).toBe(true);
    expect(validarPinAction).not.toHaveBeenCalled();
  });

  it("sem conexão, gerente (sem credencial local) não vende e a mensagem explica o motivo", async () => {
    Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
    const r = await validarPinParaVenda("1234");
    expect(r.sucesso).toBe(false);
    expect(r.erro).toMatch(/exige conexão/);
  });

  it("servidor devolve funcionário sem permissão de vender (estoquista): recusa", async () => {
    validarPinAction.mockResolvedValue({ sucesso: true, funcionario: { id: "e1", nome: "Eva", cargo: "estoquista" } });
    expect(await validarPinParaVenda("1234")).toMatchObject({ sucesso: false, erro: expect.stringMatching(/permissão/) });
  });
});

// ===========================================================================
describe("atualização do aparelho (IndexedDB v5 → v6)", () => {
  it("remove pin_hash de todos os funcionários e preserva o PIN offline só de quem apenas vende", async () => {
    getOfflineDB().close();
    await Dexie.delete("convenience-saas-offline");

    // Banco como estava antes desta mudança: funcionários com pin_hash no catálogo.
    const antigo = new Dexie("convenience-saas-offline");
    antigo.version(5).stores({
      produtos_local: "id, nome, codigo_barras, categoria_id, ativo",
      categorias_local: "id, nome, ativo",
      funcionarios_local: "id, nome, cargo, ativo",
      clientes_local: "id, nome, ativo",
      estoque_local: "produto_id",
      fila_sincronizacao: "id, tipo, status, criado_em",
      configuracoes_local: "chave",
      papel_dispositivo: "chave",
      eventos_sincronizacao: "id, tipo, timestamp",
      vendas_locais: "id, status, criado_em",
      itens_venda_locais: "id, venda_id",
      carrinho_local: "produto_id",
      auditoria_local: "id, tipo, venda_id, timestamp",
      logs_tecnicos: "id, categoria, nivel, timestamp",
    });
    await antigo.table("funcionarios_local").bulkPut([
      { id: "c1", nome: "Caixa", cargo: "caixa", pin_hash: "hash-caixa", ativo: true, updated_at: "" },
      { id: "fr1", nome: "Frentista", cargo: "frentista", pin_hash: "hash-frentista", ativo: true, updated_at: "" },
      { id: "g1", nome: "Gerente", cargo: "gerente", pin_hash: "hash-gerente", ativo: true, updated_at: "" },
      { id: "p1", nome: "Dono", cargo: "proprietario", pin_hash: "hash-dono", ativo: true, updated_at: "" },
      { id: "e1", nome: "Estoquista", cargo: "estoquista", pin_hash: "hash-estoque", ativo: true, updated_at: "" },
    ]);
    await antigo.table("fila_sincronizacao").put({
      id: "v1", tipo: "venda", payload: "{}", status: "pendente", tentativas: 0, criado_em: "2026-01-01", ultima_tentativa_em: null, erro: null,
    });
    antigo.close();

    // Abre com o código novo: roda a migração.
    vi.resetModules();
    const { getOfflineDB: abrir } = await import("../db");
    const db = abrir();
    const funcionarios = await db.funcionarios_local.toArray();

    expect(funcionarios).toHaveLength(5);
    for (const f of funcionarios) expect(Object.keys(f)).not.toContain("pin_hash");

    const credenciais = await db.credenciais_pin_local.toArray();
    expect(credenciais.map((c) => c.funcionario_id).sort()).toEqual(["c1", "fr1"]);
    expect(credenciais.find((c) => c.funcionario_id === "c1")?.pin_hash).toBe("hash-caixa");

    // a fila de vendas pendentes sobrevive à atualização
    expect((await db.fila_sincronizacao.get("v1"))?.status).toBe("pendente");
  });
});
