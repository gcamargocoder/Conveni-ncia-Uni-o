import { createSupabaseServerClient } from "./supabase/server";

export interface EventoHistorico {
  id: string;
  tipo: "venda" | "movimentacao";
  descricao: string;
  funcionario_nome: string;
  dispositivo: string | null;
  created_at: string;
}

function resumirDispositivo(userAgent: string | null): string | null {
  if (!userAgent) return null;
  // Resumo curto o suficiente pra caber na tela — não precisamos do
  // user-agent inteiro, só o essencial pra saber "de onde" veio.
  if (userAgent.includes("Android")) return "Android";
  if (userAgent.includes("iPhone") || userAgent.includes("iPad")) return "iOS";
  if (userAgent.includes("Windows")) return "Windows";
  if (userAgent.includes("Macintosh")) return "Mac";
  return "Desconhecido";
}

const ROTULOS_TIPO: Record<string, string> = {
  entrada: "Entrada de estoque",
  perda: "Perda registrada",
  ajuste_entrada: "Ajuste (a mais)",
  ajuste_saida: "Ajuste (a menos)",
  inventario: "Inventário",
  consumo_interno: "Consumo interno",
  venda: "Venda",
};

const LIMITE_EVENTOS = 500;

export async function listarHistorico(dias = 7): Promise<EventoHistorico[]> {
  const supabase = await createSupabaseServerClient();
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);

  const [{ data: vendas }, { data: movimentacoes }] = await Promise.all([
    supabase
      .from("vendas")
      .select("id, created_at, total, dispositivo, funcionarios(nome)")
      .gte("created_at", desde.toISOString())
      .order("created_at", { ascending: false })
      .limit(LIMITE_EVENTOS),
    supabase
      .from("movimentacoes_estoque")
      .select("id, created_at, tipo, quantidade, dispositivo, observacao, funcionarios(nome), produtos(nome)")
      .neq("tipo", "venda") // venda manual já aparece na lista de vendas — evita duplicar o mesmo evento
      .gte("created_at", desde.toISOString())
      .order("created_at", { ascending: false })
      .limit(LIMITE_EVENTOS),
  ]);

  const eventosVenda: EventoHistorico[] = (vendas ?? []).map((v: any) => ({
    id: v.id,
    tipo: "venda",
    descricao: `Venda finalizada — R$ ${Number(v.total).toFixed(2)}`,
    funcionario_nome: v.funcionarios?.nome ?? "—",
    dispositivo: resumirDispositivo(v.dispositivo),
    created_at: v.created_at,
  }));

  const eventosMovimentacao: EventoHistorico[] = (movimentacoes ?? []).map((m: any) => ({
    id: m.id,
    tipo: "movimentacao",
    descricao: `${ROTULOS_TIPO[m.tipo] ?? m.tipo}: ${m.produtos?.nome ?? "produto removido"} (${m.quantidade})${
      m.observacao ? ` — ${m.observacao}` : ""
    }`,
    funcionario_nome: m.funcionarios?.nome ?? "—",
    dispositivo: resumirDispositivo(m.dispositivo),
    created_at: m.created_at,
  }));

  return [...eventosVenda, ...eventosMovimentacao].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}
