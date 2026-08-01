import { describe, it, expect, beforeEach, vi } from "vitest";
import { processarFilaSincronizacao } from "../worker-sincronizacao.service";
import { registrarVendaLocal } from "../vendas-local.service";
import { enfileirar, atualizarStatus } from "../fila-sincronizacao.service";
import { listarAuditoriaLocal } from "../auditoria-local.service";
import { getOfflineDB } from "../db";
import { ItemCarrinho } from "@/lib/vendas/carrinho";
import type { PayloadVendaFila } from "@/lib/offline-sync/sincronizar-venda-action";

beforeEach(async () => {
  const db = getOfflineDB();
  await Promise.all([
    db.vendas_locais.clear(),
    db.itens_venda_locais.clear(),
    db.estoque_local.clear(),
    db.fila_sincronizacao.clear(),
    db.carrinho_local.clear(),
    db.auditoria_local.clear(),
    db.configuracoes_local.clear(),
  ]);
  // Etapa 8.2: registrarVendaLocal agora valida estoque de verdade.
  // Este arquivo testa sincronização, não estoque — mantém "p1" com
  // estoque de sobra para não interferir nesses testes.
  await db.estoque_local.put({ produto_id: "p1", quantidade_atual: 1000, estoque_minimo: 0, updated_at: "" });
});

const itensExemplo: ItemCarrinho[] = [{ produto_id: "p1", nome: "Água", preco_unitario: 3, quantidade: 2 }];

async function criarVendaPendente() {
  const resultado = await registrarVendaLocal({
    itens: itensExemplo,
    formaPagamento: "pix",
    funcionarioId: "func-1",
    funcionarioNome: "Maria",
  });
  return resultado.vendaId!;
}

describe("processarFilaSincronizacao — sincronização de vendas", () => {
  it("envia com sucesso e marca fila + venda local como sincronizadas", async () => {
    const vendaId = await criarVendaPendente();
    const enviarComSucesso = vi.fn().mockResolvedValue({ sucesso: true });

    const resultado = await processarFilaSincronizacao(enviarComSucesso);

    expect(resultado.sucesso).toBe(1);
    expect(enviarComSucesso).toHaveBeenCalledWith(vendaId, expect.objectContaining({ funcionario_id: "func-1" }));

    const db = getOfflineDB();
    expect((await db.fila_sincronizacao.get(vendaId))?.status).toBe("sincronizado");
    expect((await db.vendas_locais.get(vendaId))?.status).toBe("sincronizada");
  });

  it("registra auditoria de início, fim e sucesso do item", async () => {
    await criarVendaPendente();
    await processarFilaSincronizacao(vi.fn().mockResolvedValue({ sucesso: true }));

    const tipos = (await listarAuditoriaLocal()).map((e) => e.tipo);
    expect(tipos).toContain("sync_fila_inicio");
    expect(tipos).toContain("sync_fila_fim");
    expect(tipos).toContain("sync_item_sucesso");
  });
});

describe("processarFilaSincronizacao — perda de conexão durante envio", () => {
  it("marca o item como erro sem removê-lo da fila", async () => {
    const vendaId = await criarVendaPendente();
    const enviarComFalha = vi.fn().mockResolvedValue({ sucesso: false, erro: "falha de rede" });

    const resultado = await processarFilaSincronizacao(enviarComFalha);

    expect(resultado.falha).toBe(1);
    const db = getOfflineDB();
    const item = await db.fila_sincronizacao.get(vendaId);
    expect(item?.status).toBe("erro");
    expect(item?.erro).toBe("falha de rede");
    expect(item?.tentativas).toBe(1);

    const eventoErro = (await listarAuditoriaLocal()).find((e) => e.tipo === "sync_item_erro");
    expect(eventoErro?.detalhes).toBe("falha de rede");
  });
});

describe("processarFilaSincronizacao — retomada automática após backoff", () => {
  it("tenta de novo e sincroniza depois que o tempo de backoff passa", async () => {
    const vendaId = await criarVendaPendente();

    await processarFilaSincronizacao(vi.fn().mockResolvedValue({ sucesso: false, erro: "sem conexão" }));

    const db = getOfflineDB();
    const seiscentosAtras = new Date(Date.now() - 6000).toISOString();
    await db.fila_sincronizacao.update(vendaId, { ultima_tentativa_em: seiscentosAtras });

    const resultado = await processarFilaSincronizacao(vi.fn().mockResolvedValue({ sucesso: true }));

    expect(resultado.sucesso).toBe(1);
    expect((await db.fila_sincronizacao.get(vendaId))?.status).toBe("sincronizado");
  });

  it("NÃO tenta de novo antes do tempo de backoff passar", async () => {
    await criarVendaPendente();
    await processarFilaSincronizacao(vi.fn().mockResolvedValue({ sucesso: false, erro: "sem conexão" }));

    const enviarSegundaVez = vi.fn().mockResolvedValue({ sucesso: true });
    const resultado = await processarFilaSincronizacao(enviarSegundaVez);

    expect(enviarSegundaVez).not.toHaveBeenCalled();
    expect(resultado.ignoradosPorBackoff).toBe(1);
  });
});

describe("processarFilaSincronizacao — duplicidade", () => {
  it("não reprocessa um item já sincronizado", async () => {
    const vendaId = await criarVendaPendente();
    await processarFilaSincronizacao(vi.fn().mockResolvedValue({ sucesso: true }));

    const enviarDeNovo = vi.fn().mockResolvedValue({ sucesso: true });
    const resultado = await processarFilaSincronizacao(enviarDeNovo);

    expect(enviarDeNovo).not.toHaveBeenCalled();
    expect(resultado.processados).toBe(0);

    const db = getOfflineDB();
    expect((await db.fila_sincronizacao.get(vendaId))?.status).toBe("sincronizado");
  });
});

describe("processarFilaSincronizacao — conflito (venda já existia no servidor)", () => {
  it("trata resposta idempotente do servidor como sucesso, sem duplicar localmente", async () => {
    const vendaId = await criarVendaPendente();
    const enviarIdempotente = vi.fn().mockResolvedValue({ sucesso: true });

    await processarFilaSincronizacao(enviarIdempotente);

    const db = getOfflineDB();
    expect(await db.fila_sincronizacao.count()).toBe(1);
    expect((await db.fila_sincronizacao.get(vendaId))?.status).toBe("sincronizado");
  });
});

describe("processarFilaSincronizacao — fila vazia", () => {
  it("completa sem erro e sem processar nada", async () => {
    const resultado = await processarFilaSincronizacao(vi.fn());
    expect(resultado).toEqual({
      processados: 0,
      sucesso: 0,
      falha: 0,
      conflitosResolvidos: 0,
      ignoradosPorBackoff: 0,
    });
  });
});

describe("processarFilaSincronizacao — volume alto", () => {
  it("processa centenas de operações pendentes corretamente", async () => {
    const QUANTIDADE = 300;
    for (let i = 0; i < QUANTIDADE; i++) {
      const payload: PayloadVendaFila = {
        funcionario_id: "func-1",
        forma_pagamento: "dinheiro",
        total: 10,
        itens: [{ produto_id: "p1", quantidade: 1, preco_unitario: 10 }],
      };
      await enfileirar(`venda-${i}`, "venda", payload);
    }

    const resultado = await processarFilaSincronizacao(vi.fn().mockResolvedValue({ sucesso: true }));

    expect(resultado.sucesso).toBe(QUANTIDADE);
    const db = getOfflineDB();
    expect(await db.fila_sincronizacao.where("status").equals("sincronizado").count()).toBe(QUANTIDADE);
  }, 15000);
});