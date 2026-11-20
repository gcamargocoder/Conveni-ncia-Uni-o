import { Prisma } from "@prisma/client";
import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";
import { ItemCarrinho } from "@/lib/vendas/carrinho";
import { FormaPagamento } from "@/types/venda";
import { gerarUuid } from "@/lib/utils/uuid";
import { totalEmCentavos } from "@/lib/vendas/validacao-sincronizacao";
import { CaixaError, lancarVendaNoCaixa, type Autoria } from "./caixa.service";
import type { PagamentoVenda } from "@/lib/caixa/validacao";
import { horarioDaVenda, ocorridoEmParaGravar } from "@/lib/vendas/horario";

export interface DadosVenda {
  id?: string;
  funcionario_id: string;
  /** Login autenticado responsável pelo registro (≠ funcionário selecionado no PDV). */
  usuario_id?: string | null;
  forma_pagamento: FormaPagamento | "misto";
  itens: ItemCarrinho[];
  dispositivo?: string;
  cliente_id?: string | null;
  /** Caixa (terminal) em que a venda foi feita. Ausente só em vendas legadas aprovadas pelo administrador. */
  caixa_id?: string | null;
  /** Cada forma de pagamento da venda (pagamento dividido). Ausente = uma forma com o total. */
  pagamentos?: PagamentoVenda[];
  /** Relógio do terminal quando a venda aconteceu (gravado em `ocorrido_em`; `created_at` é sempre o horário do servidor). */
  ocorrido_em?: string | null;
  origem?: "online" | "offline";
}

export interface ResultadoRegistrarVenda {
  id: string;
  jaExistia: boolean;
}

type ClienteTransacao = Prisma.TransactionClient;

/**
 * Grava venda + itens (+ conta a receber, se fiado) dentro de uma transação já aberta.
 * Idempotente pelo id. A movimentação de estoque de cada item nasce sozinha pela
 * trigger trg_itens_venda_gera_movimentacao, na MESMA transação: se a venda for
 * desfeita (ex.: duas sincronizações simultâneas do mesmo id), a baixa de estoque
 * também é desfeita — nunca há baixa duplicada nem baixa sem venda.
 */
export async function gravarVendaNaTransacao(tx: ClienteTransacao, dados: DadosVenda): Promise<ResultadoRegistrarVenda> {
  const id = dados.id ?? gerarUuid();
  const clienteId = dados.cliente_id ?? null;
  const dispositivo = dados.dispositivo ?? null;
  // Centavos inteiros: sem erro de ponto flutuante no total gravado.
  const total = totalEmCentavos(dados.itens) / 100;

  const totalCentavos = totalEmCentavos(dados.itens);
  const pagamentos: PagamentoVenda[] =
    dados.pagamentos && dados.pagamentos.length > 0
      ? dados.pagamentos
      : [{ forma: dados.forma_pagamento as PagamentoVenda["forma"], valor_centavos: totalCentavos }];
  const formaVenda = pagamentos.length > 1 ? "misto" : pagamentos[0].forma;
  const centavosFiado = pagamentos.filter((p) => p.forma === "fiado").reduce((s, p) => s + p.valor_centavos, 0);

  if (centavosFiado > 0 && !clienteId) {
    throw new Error("Erro ao registrar venda: venda fiado exige um cliente.");
  }
  if (pagamentos.reduce((s, p) => s + p.valor_centavos, 0) !== totalCentavos) {
    throw new Error("Erro ao registrar venda: a soma dos pagamentos não confere com o total.");
  }

  const existente = await tx.venda.findUnique({ where: { id }, select: { id: true } });
  if (existente) return { id, jaExistia: true };

  await tx.venda.create({
    data: {
      id,
      funcionario_id: dados.funcionario_id,
      usuario_id: dados.usuario_id ?? null,
      cliente_id: clienteId,
      forma_pagamento: formaVenda,
      total,
      dispositivo,
      // created_at fica com o padrão do banco: o horário em que o SERVIDOR gravou. O relógio do dispositivo nunca o substitui;
      // ele vai para ocorrido_em (só se for uma data válida e dentro da tolerância; a janela de 48 h e a abertura do caixa
      // são conferidas antes, em processarVendaRecebida, que retém a venda para revisão quando não passam).
      ocorrido_em: ocorridoEmParaGravar(dados.ocorrido_em),
    },
  });

  await tx.itemVenda.createMany({
    data: dados.itens.map((i) => ({
      venda_id: id,
      produto_id: i.produto_id,
      quantidade: i.quantidade,
      preco_unitario: i.preco_unitario,
    })),
  });

  await tx.movimentacaoEstoque.updateMany({ where: { venda_id: id }, data: { dispositivo } });

  if (centavosFiado > 0 && clienteId) {
    // Só a parcela fiada vira conta a receber; o restante foi pago na hora.
    const valorFiado = centavosFiado / 100;
    await tx.contaReceber.create({
      data: { cliente_id: clienteId, venda_id: id, valor_original: valorFiado, saldo_atual: valorFiado, status: "ABERTA" },
    });
  }

  if (dados.caixa_id) {
    // Mesma transação da venda: ou grava venda + movimentos do caixa, ou nada.
    const autoria: Autoria = {
      funcionario_id: dados.funcionario_id,
      usuario_id: dados.usuario_id ?? null,
      dispositivo: dispositivo ?? "",
      origem: dados.origem ?? "online",
    };
    await lancarVendaNoCaixa(tx, { venda_id: id, caixa_id: dados.caixa_id, pagamentos, ocorrido_em: dados.ocorrido_em ?? new Date() }, autoria);
  }

  return { id, jaExistia: false };
}

/**
 * Registra a venda numa transação própria. Reenviar o mesmo `id` nunca duplica nada —
 * devolve `jaExistia: true`. ATENÇÃO: este método NÃO confere preços nem funcionário;
 * quem recebe dados do navegador deve passar por `processarVendaRecebida`
 * (services/vendas-sincronizadas.service.ts).
 */
export async function registrarVenda(dados: DadosVenda): Promise<ResultadoRegistrarVenda> {
  const id = dados.id ?? gerarUuid();

  // `executar` reembrulha qualquer Error numa mensagem genérica; o erro do caixa (ex.: caixa fechado no meio
  // da gravação) precisa chegar intacto a quem decide reter a venda para o administrador.
  let erroCaixa: CaixaError | null = null;
  try {
    return await executar<ResultadoRegistrarVenda>(
      () =>
        prisma.$transaction(
          async (tx) => {
            try {
              return await gravarVendaNaTransacao(tx, { ...dados, id });
            } catch (e) {
              if (e instanceof CaixaError) erroCaixa = e;
              throw e;
            }
          },
          { timeout: 15000 }
        ),
      "Erro ao registrar venda"
    );
  } catch (e) {
    if (erroCaixa) throw erroCaixa;
    // Duas sincronizações simultâneas do mesmo id: a segunda perde a corrida no PK
    // e a venda já está gravada pela primeira — idempotência preservada.
    const existente = await prisma.venda.findUnique({ where: { id }, select: { id: true } }).catch(() => null);
    if (existente) return { id, jaExistia: true };
    throw e;
  }
}

export interface ItemVendaDetalhado {
  produto_nome: string;
  quantidade: number;
  preco_unitario: number;
}

export interface VendaCompleta {
  id: string;
  /** Horário em que a venda ACONTECEU (ocorrido_em, ou created_at nas vendas antigas): é o do recibo. */
  created_at: string;
  /** Horário em que o servidor gravou a venda (created_at). */
  recebido_em?: string;
  total: number;
  forma_pagamento: string;
  cancelada: boolean;
  funcionario_nome: string;
  cliente_nome?: string | null;
  cliente_telefone?: string | null;
  desconto?: number | null;
  valor_recebido?: number | null;
  troco?: number | null;
  /** Pagamento dividido: cada forma e seu valor em reais (apenas para exibição do recibo). */
  pagamentos?: { forma: string; valor: number }[];
  itens: ItemVendaDetalhado[];
}

export async function buscarVendaCompleta(vendaId: string): Promise<VendaCompleta | null> {
  let venda: any;
  try {
    venda = await executar<any>(
      () =>
        prisma.venda.findUnique({
          where: { id: vendaId },
          select: {
            id: true,
            created_at: true,
            ocorrido_em: true,
            total: true,
            forma_pagamento: true,
            cancelada: true,
            funcionario: { select: { nome: true } },
            cliente: { select: { nome: true, telefone: true } },
            itens: { select: { quantidade: true, preco_unitario: true, produto: { select: { nome: true } } } },
          },
        }),
      "Erro ao buscar venda"
    );
  } catch {
    return null;
  }

  if (!venda) return null;

  const { funcionario, cliente, itens, ocorrido_em, ...dadosVenda } = venda;

  return {
    ...dadosVenda,
    // O recibo mostra QUANDO A VENDA ACONTECEU (ocorrido_em; venda antiga: created_at) e guarda à parte quando o servidor a recebeu.
    created_at: horarioDaVenda({ created_at: dadosVenda.created_at, ocorrido_em }).toISOString(),
    recebido_em: new Date(dadosVenda.created_at).toISOString(),
    funcionario_nome: funcionario?.nome ?? "—",
    cliente_nome: cliente?.nome ?? null,
    cliente_telefone: cliente?.telefone ?? null,
    itens: itens.map((i: any) => ({
      produto_nome: i.produto?.nome ?? "Produto removido",
      quantidade: i.quantidade,
      preco_unitario: i.preco_unitario,
    })),
  };
}
