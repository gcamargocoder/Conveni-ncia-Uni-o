import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";

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
  const produtoSelecionado = { select: { nome: true, codigo_barras: true } } as const;
  const funcionarioSelecionado = { select: { nome: true } } as const;

  const [vendas, movimentacoes] = await Promise.all([
    executar<any[]>(
      () =>
        prisma.venda.findMany({
          select: {
            id: true,
            created_at: true,
            total: true,
            dispositivo: true,
            funcionario: funcionarioSelecionado,
            itens: { select: { produto: produtoSelecionado } },
          },
          where: { created_at: { gte: inicio, lte: fim } },
          orderBy: { created_at: "desc" },
          take: LIMITE_EVENTOS,
        }),
      "Erro ao listar vendas do histórico"
    ),
    executar<any[]>(
      () =>
        prisma.movimentacaoEstoque.findMany({
          select: {
            id: true,
            created_at: true,
            tipo: true,
            quantidade: true,
            dispositivo: true,
            observacao: true,
            funcionario: funcionarioSelecionado,
            produto: produtoSelecionado,
          },
          where: { tipo: { not: "venda" }, created_at: { gte: inicio, lte: fim } },
          orderBy: { created_at: "desc" },
          take: LIMITE_EVENTOS,
        }),
      "Erro ao listar movimentações do histórico"
    ),
  ]);

  const eventosVenda: EventoHistorico[] = vendas.map((v: any) => {
    const itens = v.itens ?? [];
    const nomesProdutos: string[] = itens.map((iv: any) => iv.produto?.nome).filter(Boolean);
    const codigosBarras: string[] = itens.map((iv: any) => iv.produto?.codigo_barras).filter(Boolean);
    const funcionarioNome = v.funcionario?.nome ?? "—";

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

  const eventosMovimentacao: EventoHistorico[] = movimentacoes.map((m: any) => {
    const produtoNome = m.produto?.nome ?? "produto removido";
    const codigoBarras = m.produto?.codigo_barras ?? "";
    const funcionarioNome = m.funcionario?.nome ?? "—";
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