import { createSupabaseServerClient } from "./supabase/server";
import { unwrap } from "./supabase/query-helpers";

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
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("vendas")
    .select("id, created_at, total, forma_pagamento, cancelada")
    .gte("created_at", inicio.toISOString())
    .lte("created_at", fim.toISOString())
    .order("created_at", { ascending: false })
    .limit(LIMITE_VENDAS_RELATORIO);

  return unwrap(resultado, "Erro ao listar vendas");
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
