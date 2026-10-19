import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";

export interface VendaRelatorio {
  id: string;
  created_at: string;
  total: number;
  forma_pagamento: string;
  cancelada: boolean;
}

export interface ResumoPorFormaPagamento {
  forma_pagamento: string;
  quantidade: number;
  total: number;
}

const LIMITE_VENDAS_RELATORIO = 1000;

export async function listarVendasPorPeriodo(inicio: Date, fim: Date): Promise<VendaRelatorio[]> {
  return executar(
    () =>
      prisma.venda.findMany({
        select: { id: true, created_at: true, total: true, forma_pagamento: true, cancelada: true },
        where: { created_at: { gte: inicio, lte: fim } },
        orderBy: { created_at: "desc" },
        take: LIMITE_VENDAS_RELATORIO,
      }),
    "Erro ao listar vendas"
  );
}

export function resumirPorFormaPagamento(vendas: VendaRelatorio[]): ResumoPorFormaPagamento[] {
  const mapa = new Map<string, ResumoPorFormaPagamento>();

  for (const v of vendas) {
    if (v.cancelada) continue; // venda cancelada não entra no faturamento
    const atual = mapa.get(v.forma_pagamento) ?? {
      forma_pagamento: v.forma_pagamento,
      quantidade: 0,
      total: 0,
    };
    atual.quantidade += 1;
    atual.total += v.total;
    mapa.set(v.forma_pagamento, atual);
  }

  return Array.from(mapa.values()).sort((a, b) => b.total - a.total);
}
