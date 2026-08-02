import { createSupabaseServerClient } from "./supabase/server";

export interface EventoHistorico {
  id: string;
  tipo: "venda" | "movimentacao";
  descricao: string;
  funcionario_nome: string;
  dispositivo: string | null;
  created_at: string;
  texto_busca: string;
  produto_nome: string;
  quantidade: number | null;
  tipo_rotulo: string;
  observacao: string | null;
}

function resumirDispositivo(userAgent: string | null): string | null {
  if (!userAgent) return null;
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

export async function listarHistorico(inicio: Date, fim: Date): Promise<EventoHistorico[]> {
  const supabase = await createSupabaseServerClient();

  const [{ data: vendas }, { data: movimentacoes }] = await Promise.all([
    supabase
      .from("vendas")
      .select("id, created_at, total, dispositivo, funcionarios(nome), itens_venda(produtos(nome, codigo_barras))")
      .gte("created_at", inicio.toISOString())
      .lte("created_at", fim.toISOString())
      .order("created_at", { ascending: false })
      .limit(LIMITE_EVENTOS),
    supabase
      .from("movimentacoes_estoque")
      .select(
        "id, created_at, tipo, quantidade, dispositivo, observacao, funcionarios(nome), produtos(nome, codigo_barras)"
      )
      .neq("tipo", "venda")
      .gte("created_at", inicio.toISOString())
      .lte("created_at", fim.toISOString())
      .order("created_at", { ascending: false })
      .limit(LIMITE_EVENTOS),
  ]);

  const eventosVenda: EventoHistorico[] = (vendas ?? []).map((v: any) => {
    const itens = v.itens_venda ?? [];
    const nomesProdutos: string[] = itens.map((iv: any) => iv.produtos?.nome).filter(Boolean);
    const codigosBarras: string[] = itens.map((iv: any) => iv.produtos?.codigo_barras).filter(Boolean);
    const funcionarioNome = v.funcionarios?.nome ?? "—";

    return {
      id: v.id,
      tipo: "venda",
      descricao: `Venda finalizada — R$ ${Number(v.total).toFixed(2)}`,
      funcionario_nome: funcionarioNome,
      dispositivo: resumirDispositivo(v.dispositivo),
      created_at: v.created_at,
      texto_busca: ["venda", funcionarioNome, ...nomesProdutos, ...codigosBarras].join(" ").toLowerCase(),
      produto_nome: nomesProdutos.length > 0 ? nomesProdutos.join(", ") : "—",
      quantidade: null,
      tipo_rotulo: "Venda",
      observacao: `Total: R$ ${Number(v.total).toFixed(2)}`,
    };
  });

  const eventosMovimentacao: EventoHistorico[] = (movimentacoes ?? []).map((m: any) => {
    const produtoNome = m.produtos?.nome ?? "produto removido";
    const codigoBarras = m.produtos?.codigo_barras ?? "";
    const funcionarioNome = m.funcionarios?.nome ?? "—";
    const rotuloTipo = ROTULOS_TIPO[m.tipo] ?? m.tipo;

    return {
      id: m.id,
      tipo: "movimentacao",
      descricao: `${rotuloTipo}: ${produtoNome} (${m.quantidade})${m.observacao ? ` — ${m.observacao}` : ""}`,
      funcionario_nome: funcionarioNome,
      dispositivo: resumirDispositivo(m.dispositivo),
      created_at: m.created_at,
      texto_busca: [m.tipo, rotuloTipo, produtoNome, codigoBarras, funcionarioNome].join(" ").toLowerCase(),
      produto_nome: produtoNome,
      quantidade: m.quantidade,
      tipo_rotulo: rotuloTipo,
      observacao: m.observacao ?? null,
    };
  });

  return [...eventosVenda, ...eventosMovimentacao].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}