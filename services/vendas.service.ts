import { createSupabaseServerClient } from "./supabase/server";
import { unwrap } from "./supabase/query-helpers";
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

export async function registrarVenda(dados: DadosVenda): Promise<ResultadoRegistrarVenda> {
  const supabase = await createSupabaseServerClient();
  const total = dados.itens.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0);
  const id = dados.id ?? gerarUuid();

  const resultado = await supabase.rpc("registrar_venda_completa", {
    p_id: id,
    p_funcionario_id: dados.funcionario_id,
    p_forma_pagamento: dados.forma_pagamento,
    p_total: total,
    p_dispositivo: dados.dispositivo ?? null,
    p_itens: dados.itens.map((i) => ({
      produto_id: i.produto_id,
      quantidade: i.quantidade,
      preco_unitario: i.preco_unitario,
    })),
    p_cliente_id: dados.cliente_id ?? null,
  });

  const dados_retorno = unwrap(resultado, "Erro ao registrar venda") as { id: string; ja_existia: boolean };
  return { id: dados_retorno.id, jaExistia: dados_retorno.ja_existia };
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
  itens: ItemVendaDetalhado[];
}

export async function buscarVendaCompleta(vendaId: string): Promise<VendaCompleta | null> {
  const supabase = await createSupabaseServerClient();

  const resultadoVenda = await supabase
    .from("vendas")
    .select("id, created_at, total, forma_pagamento, cancelada, funcionarios(nome), clientes(nome, telefone)")
    .eq("id", vendaId)
    .single();

  if (resultadoVenda.error || !resultadoVenda.data) return null;

  const resultadoItens = await supabase
    .from("itens_venda")
    .select("quantidade, preco_unitario, produtos(nome)")
    .eq("venda_id", vendaId);

  const itens = unwrap(resultadoItens, "Erro ao buscar itens da venda");
  const { funcionarios, clientes, ...dadosVenda } = resultadoVenda.data as any;

  return {
    ...dadosVenda,
    funcionario_nome: funcionarios?.nome ?? "—",
    cliente_nome: clientes?.nome ?? null,
    cliente_telefone: clientes?.telefone ?? null,
    itens: (itens ?? []).map((i: any) => ({
      produto_nome: i.produtos?.nome ?? "Produto removido",
      quantidade: i.quantidade,
      preco_unitario: i.preco_unitario,
    })),
  };
}