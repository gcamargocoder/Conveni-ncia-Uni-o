import { Prisma } from "@prisma/client";
import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";
import { ItemCarrinho } from "@/lib/vendas/carrinho";
import { FormaPagamento } from "@/types/venda";
import { gerarUuid } from "@/lib/utils/uuid";
import { totalEmCentavos } from "@/lib/vendas/validacao-sincronizacao";

export interface DadosVenda {
  id?: string;
  funcionario_id: string;
  /** Login autenticado responsável pelo registro (≠ funcionário selecionado no PDV). */
  usuario_id?: string | null;
  forma_pagamento: FormaPagamento;
  itens: ItemCarrinho[];
  dispositivo?: string;
  cliente_id?: string | null;
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

  if (dados.forma_pagamento === "fiado" && !clienteId) {
    throw new Error("Erro ao registrar venda: venda fiado exige um cliente.");
  }

  const existente = await tx.venda.findUnique({ where: { id }, select: { id: true } });
  if (existente) return { id, jaExistia: true };

  await tx.venda.create({
    data: {
      id,
      funcionario_id: dados.funcionario_id,
      usuario_id: dados.usuario_id ?? null,
      cliente_id: clienteId,
      forma_pagamento: dados.forma_pagamento,
      total,
      dispositivo,
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

  if (dados.forma_pagamento === "fiado" && clienteId) {
    await tx.contaReceber.create({
      data: { cliente_id: clienteId, venda_id: id, valor_original: total, saldo_atual: total, status: "ABERTA" },
    });
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

  try {
    return await executar<ResultadoRegistrarVenda>(
      () => prisma.$transaction((tx) => gravarVendaNaTransacao(tx, { ...dados, id }), { timeout: 15000 }),
      "Erro ao registrar venda"
    );
  } catch (e) {
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
  created_at: string;
  total: number;
  forma_pagamento: string;
  cancelada: boolean;
  funcionario_nome: string;
  cliente_nome?: string | null;
  cliente_telefone?: string | null;
  desconto?: number | null;
  valor_recebido?: number | null;
  troco?: number | null;
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

  const { funcionario, cliente, itens, ...dadosVenda } = venda;

  return {
    ...dadosVenda,
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
