import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";
import { ItemCarrinho } from "@/lib/vendas/carrinho";
import { FormaPagamento } from "@/types/venda";
import { gerarUuid } from "@/lib/utils/uuid";

export interface DadosVenda {
  id?: string;
  funcionario_id: string;
  forma_pagamento: FormaPagamento;
  itens: ItemCarrinho[];
  dispositivo?: string;
  cliente_id?: string | null;
}

export interface ResultadoRegistrarVenda {
  id: string;
  jaExistia: boolean;
}

/**
 * Grava venda + itens (+ conta a receber, se fiado) numa única transação.
 * Idempotente: reenviar o mesmo `id` nunca duplica nada — devolve
 * `jaExistia: true`. A movimentação de estoque de cada item nasce sozinha
 * pela trigger trg_itens_venda_gera_movimentacao do banco.
 */
export async function registrarVenda(dados: DadosVenda): Promise<ResultadoRegistrarVenda> {
  const total = dados.itens.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0);
  const id = dados.id ?? gerarUuid();
  const dispositivo = dados.dispositivo ?? null;
  const clienteId = dados.cliente_id ?? null;

  if (dados.forma_pagamento === "fiado" && !clienteId) {
    throw new Error("Erro ao registrar venda: venda fiado exige um cliente.");
  }

  try {
    return await executar<ResultadoRegistrarVenda>(
      () =>
        prisma.$transaction(async (tx) => {
          const existente = await tx.venda.findUnique({ where: { id }, select: { id: true } });
          if (existente) return { id, jaExistia: true };

          await tx.venda.create({
            data: {
              id,
              funcionario_id: dados.funcionario_id,
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
        }),
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
