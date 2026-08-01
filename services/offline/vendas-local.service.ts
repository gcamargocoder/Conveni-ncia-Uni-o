import { getOfflineDB, VendaLocal, ItemVendaLocal } from "./db";
import { ItemCarrinho } from "@/lib/vendas/carrinho";
import { FormaPagamento } from "@/types/venda";
import { registrarEventoAuditoriaLocal } from "./auditoria-local.service";
import { obterOuCriarIdentificadorDispositivo } from "./configuracao-local.service";
import { obterPapelDispositivo } from "./dispositivo.service";
import { gerarUuid } from "@/lib/utils/uuid";

export interface DadosVendaLocal {
  itens: ItemCarrinho[];
  formaPagamento: FormaPagamento;
  funcionarioId: string;
  funcionarioNome: string;
}

export interface ResultadoVendaLocal {
  sucesso: boolean;
  vendaId?: string;
  erro?: string;
}

/**
 * Grava a venda inteiramente no banco local — nenhuma chamada de rede
 * acontece aqui (regra da Fase 3: nenhuma venda vai para a nuvem ainda).
 * Tudo dentro de UMA transação Dexie: venda, itens, decremento de
 * estoque, item na fila de sincronização e limpeza do carrinho. Se
 * qualquer parte falhar, o Dexie desfaz tudo automaticamente — nunca
 * existe venda gravada sem item, ou item sem baixa de estoque.
 *
 * O UUID da venda é gerado AQUI, uma vez só, e reaproveitado como o
 * mesmo id do item da fila — quando a fase de sincronização enviar
 * isso ao servidor, reenviar o mesmo id nunca duplica.
 */
export async function registrarVendaLocal(dados: DadosVendaLocal): Promise<ResultadoVendaLocal> {
  const inicioMs = Date.now();
  const vendaId = gerarUuid();
  const dispositivo = await obterOuCriarIdentificadorDispositivo();
  const papel = await obterPapelDispositivo();
  const terminal = papel?.tipo ?? "principal";

  await registrarEventoAuditoriaLocal("venda_iniciada", {
    venda_id: vendaId,
    funcionario_id: dados.funcionarioId,
    dispositivo,
  });

  const total = dados.itens.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0);
  const criado_em = new Date().toISOString();

  const venda: VendaLocal = {
    id: vendaId,
    funcionario_id: dados.funcionarioId,
    funcionario_nome: dados.funcionarioNome,
    forma_pagamento: dados.formaPagamento,
    total,
    terminal,
    dispositivo,
    status: "pendente_sincronizacao",
    cancelada: false,
    criado_em,
  };

  const itensLocais: ItemVendaLocal[] = dados.itens.map((i) => ({
    id: gerarUuid(),
    venda_id: vendaId,
    produto_id: i.produto_id,
    produto_nome: i.nome,
    quantidade: i.quantidade,
    preco_unitario: i.preco_unitario,
  }));

  try {
    const db = getOfflineDB();

    // Dupla validação (Etapa 8.2) — a tela já valida antes de deixar o
    // operador chegar até aqui, mas essa é a barreira de verdade: se
    // por qualquer motivo (estado desatualizado, corrida entre duas
    // abas) uma quantidade acima do disponível chegar até aqui, a
    // venda é bloqueada agora, antes de gravar qualquer coisa.
    for (const item of dados.itens) {
      const estoqueAtual = await db.estoque_local.get(item.produto_id);
      const disponivel = estoqueAtual?.quantidade_atual ?? 0;
      if (item.quantidade > disponivel) {
        await registrarEventoAuditoriaLocal("venda_bloqueada_estoque", {
          venda_id: vendaId,
          funcionario_id: dados.funcionarioId,
          dispositivo,
          detalhes: `${item.nome}: solicitado ${item.quantidade}, disponível ${disponivel}`,
        });
        return {
          sucesso: false,
          erro: `Estoque insuficiente para ${item.nome}. Disponível: ${disponivel}, solicitado: ${item.quantidade}.`,
        };
      }
    }

    await db.transaction(
      "rw",
      db.vendas_locais,
      db.itens_venda_locais,
      db.estoque_local,
      db.fila_sincronizacao,
      db.carrinho_local,
      async () => {
        await db.vendas_locais.put(venda);
        await db.itens_venda_locais.bulkPut(itensLocais);

        // Baixa de estoque local. Chegou até aqui só porque a
        // validação acima (antes da transação) já confirmou que há
        // estoque suficiente — não deveria ficar negativo em uso
        // normal, mas o cálculo continua sendo feito por segurança.
        for (const item of dados.itens) {
          const atual = await db.estoque_local.get(item.produto_id);
          await db.estoque_local.put({
            produto_id: item.produto_id,
            quantidade_atual: (atual?.quantidade_atual ?? 0) - item.quantidade,
            estoque_minimo: atual?.estoque_minimo ?? 0,
            updated_at: criado_em,
          });
        }

        const payloadSincronizacao = {
          funcionario_id: dados.funcionarioId,
          forma_pagamento: dados.formaPagamento,
          total,
          dispositivo,
          terminal,
          itens: dados.itens.map((i) => ({
            produto_id: i.produto_id,
            quantidade: i.quantidade,
            preco_unitario: i.preco_unitario,
          })),
        };

        await db.fila_sincronizacao.put({
          id: vendaId,
          tipo: "venda",
          payload: JSON.stringify(payloadSincronizacao),
          status: "pendente",
          tentativas: 0,
          criado_em,
          ultima_tentativa_em: null,
          erro: null,
        });

        await db.carrinho_local.clear();
      }
    );

    await registrarEventoAuditoriaLocal("fila_item_criado", { venda_id: vendaId, dispositivo });
    await registrarEventoAuditoriaLocal("venda_concluida", {
      venda_id: vendaId,
      funcionario_id: dados.funcionarioId,
      dispositivo,
      duracao_ms: Date.now() - inicioMs,
    });

    return { sucesso: true, vendaId };
  } catch (e) {
    const mensagem = (e as Error).message;
    await registrarEventoAuditoriaLocal("venda_erro", {
      venda_id: vendaId,
      funcionario_id: dados.funcionarioId,
      dispositivo,
      detalhes: mensagem,
      duracao_ms: Date.now() - inicioMs,
    });
    return { sucesso: false, erro: mensagem };
  }
}

export async function listarVendasLocaisPendentes(): Promise<VendaLocal[]> {
  const db = getOfflineDB();
  return db.vendas_locais.where("status").equals("pendente_sincronizacao").toArray();
}

export async function buscarItensDaVendaLocal(vendaId: string): Promise<ItemVendaLocal[]> {
  const db = getOfflineDB();
  return db.itens_venda_locais.where("venda_id").equals(vendaId).toArray();
}