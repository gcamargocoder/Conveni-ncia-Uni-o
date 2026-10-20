import { describe, it, expect, beforeEach, vi } from "vitest";
import { processarFilaSincronizacao } from "../worker-sincronizacao.service";
import { registrarVendaLocal } from "../vendas-local.service";
import { getOfflineDB } from "../db";
import { ItemCarrinho } from "@/lib/vendas/carrinho";

/**
 * Autenticação × Offline First: quando a sessão do usuário expira, a fila de
 * vendas pendentes NÃO pode perder nem corromper nada — só esperar o novo login.
 */

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
  await db.estoque_local.put({ produto_id: "p1", quantidade_atual: 1000, estoque_minimo: 0, updated_at: "" });
});

const itens: ItemCarrinho[] = [{ produto_id: "p1", nome: "Água", preco_unitario: 3, quantidade: 1 }];

async function venda() {
  const r = await registrarVendaLocal({ itens, formaPagamento: "pix", funcionarioId: "f1", funcionarioNome: "Maria" });
  return r.vendaId!;
}

describe("fila de sincronização com sessão expirada", () => {
  it("mantém a venda pendente, sem contar tentativa nem aplicar backoff", async () => {
    const id = await venda();
    const enviar = vi.fn().mockResolvedValue({ sucesso: false, erro: "Sua sessão expirou.", requerLogin: true });

    await processarFilaSincronizacao(enviar);

    const item = await getOfflineDB().fila_sincronizacao.get(id);
    expect(item?.status).toBe("pendente");
    expect(item?.tentativas).toBe(0);
    expect((await getOfflineDB().vendas_locais.get(id))?.status).not.toBe("sincronizada");
  });

  it("para de tentar as demais vendas (nenhuma passaria sem sessão)", async () => {
    await venda();
    await venda();
    await venda();
    const enviar = vi.fn().mockResolvedValue({ sucesso: false, erro: "Sua sessão expirou.", requerLogin: true });

    await processarFilaSincronizacao(enviar);

    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("depois do novo login, as vendas guardadas são enviadas normalmente", async () => {
    const id = await venda();
    await processarFilaSincronizacao(vi.fn().mockResolvedValue({ sucesso: false, requerLogin: true, erro: "x" }));

    const enviar = vi.fn().mockResolvedValue({ sucesso: true });
    const resultado = await processarFilaSincronizacao(enviar);

    expect(resultado.sucesso).toBe(1);
    expect((await getOfflineDB().fila_sincronizacao.get(id))?.status).toBe("sincronizado");
  });

  it("exceção inesperada no envio não deixa o item preso em 'sincronizando'", async () => {
    const id = await venda();
    const enviar = vi.fn().mockRejectedValue(new Error("An unexpected response was received from the server."));

    await processarFilaSincronizacao(enviar);

    const item = await getOfflineDB().fila_sincronizacao.get(id);
    expect(item?.status).toBe("erro");
    expect(item?.tentativas).toBe(1);
  });
});
