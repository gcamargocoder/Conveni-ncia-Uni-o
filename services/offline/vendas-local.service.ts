import { getOfflineDB, VendaLocal, ItemVendaLocal } from "./db";
import { ItemCarrinho } from "@/lib/vendas/carrinho";
import { FormaPagamento } from "@/types/venda";
import { registrarEventoAuditoriaLocal } from "./auditoria-local.service";
import { obterOuCriarIdentificadorDispositivo } from "./configuracao-local.service";
import { obterPapelDispositivo } from "./dispositivo.service";
import { gerarUuid } from "@/lib/utils/uuid";
import { exigirCaixaAbertoLocal, movimentosDaVenda, estaOnline, CaixaLocalError } from "./caixa-local.service";
import { validarPagamentosVenda, type PagamentoVenda } from "@/lib/caixa/validacao";
import { totalEmCentavos } from "@/lib/vendas/validacao-sincronizacao";

export interface DadosVendaLocal {
  itens: ItemCarrinho[];
  formaPagamento: FormaPagamento;
  funcionarioId: string;
  funcionarioNome: string;
  clienteId?: string | null;
  /** Pagamento dividido: cada forma com seu valor (a soma deve fechar o total). Ausente = uma forma com o total. */
  pagamentos?: PagamentoVenda[];
}

export interface ResultadoVendaLocal {
  sucesso: boolean;
  vendaId?: string;
  erro?: string;
}

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

  const totalCentavos = totalEmCentavos(dados.itens);
  const total = totalCentavos / 100;
  const criado_em = new Date().toISOString();
  const pagamentos: PagamentoVenda[] =
    dados.pagamentos && dados.pagamentos.length > 0 ? dados.pagamentos : [{ forma: dados.formaPagamento, valor_centavos: totalCentavos }];
  const formaVenda = pagamentos.length > 1 ? "misto" : pagamentos[0].forma;

  const venda: VendaLocal = {
    id: vendaId,
    funcionario_id: dados.funcionarioId,
    funcionario_nome: dados.funcionarioNome,
    forma_pagamento: formaVenda,
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

    if (pagamentos.some((p) => p.forma === "fiado") && !dados.clienteId) {
      return { sucesso: false, erro: "Venda fiado exige um cliente selecionado." };
    }
    const errosPagamento = validarPagamentosVenda(pagamentos, totalCentavos);
    if (errosPagamento.length > 0) return { sucesso: false, erro: errosPagamento[0] };

    // Venda presencial exige caixa ABERTO neste terminal.
    let caixa;
    try {
      caixa = await exigirCaixaAbertoLocal();
    } catch (e) {
      if (e instanceof CaixaLocalError) return { sucesso: false, erro: e.message };
      throw e;
    }
    const movimentos = movimentosDaVenda({
      caixa,
      vendaId,
      pagamentos,
      responsavel: { id: dados.funcionarioId, nome: dados.funcionarioNome },
      ocorridoEm: criado_em,
    });

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
      [db.vendas_locais, db.itens_venda_locais, db.estoque_local, db.fila_sincronizacao, db.carrinho_local, db.movimentos_caixa_locais],
      async () => {
        await db.vendas_locais.put(venda);
        await db.movimentos_caixa_locais.bulkPut(movimentos);
        await db.itens_venda_locais.bulkPut(itensLocais);

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
          forma_pagamento: formaVenda,
          total,
          caixa_id: caixa.id,
          pagamentos,
          criado_em,
          origem: estaOnline() ? ("online" as const) : ("offline" as const),
          dispositivo,
          terminal,
          itens: dados.itens.map((i) => ({
            produto_id: i.produto_id,
            quantidade: i.quantidade,
            preco_unitario: i.preco_unitario,
          })),
          cliente_id: dados.clienteId ?? null,
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