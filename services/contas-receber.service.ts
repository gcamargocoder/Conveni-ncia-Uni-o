import { createSupabaseServerClient } from "./supabase/server";
import { unwrap } from "./supabase/query-helpers";
import { ContaReceber, ContaReceberComCliente, Recebimento, StatusConta } from "@/types/conta-receber";
import { Cliente } from "@/types/cliente";

const LIMITE_LISTAGEM = 500;

export interface DadosContaReceber {
  cliente_id: string;
  venda_id: string;
  valor_original: number;
}

export async function criarContaReceber(dados: DadosContaReceber): Promise<ContaReceber> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("contas_receber")
    .insert({ ...dados, saldo_atual: dados.valor_original, status: "ABERTA" })
    .select()
    .single();

  return unwrap(resultado, "Erro ao criar conta a receber");
}

export async function listarContas(status?: StatusConta): Promise<ContaReceberComCliente[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("contas_receber")
    .select("*, clientes(nome), vendas(created_at)")
    .order("created_at", { ascending: false })
    .limit(LIMITE_LISTAGEM);

  if (status) {
    query = query.eq("status", status);
  }

  const resultado = await query;
  const linhas = unwrap(resultado, "Erro ao listar contas a receber");

  return (linhas as any[]).map((l) => {
    const { clientes, vendas, ...conta } = l;
    return {
      ...conta,
      cliente_nome: clientes?.nome ?? "—",
      venda_created_at: vendas?.created_at ?? conta.created_at,
    };
  });
}

export interface DetalheContaReceber {
  conta: ContaReceberComCliente;
  cliente: Cliente;
  pagamentos: Recebimento[];
}

export async function buscarConta(id: string): Promise<DetalheContaReceber | null> {
  const supabase = await createSupabaseServerClient();

  const resultadoConta = await supabase
    .from("contas_receber")
    .select("*, clientes(*), vendas(created_at)")
    .eq("id", id)
    .single();

  if (resultadoConta.error || !resultadoConta.data) return null;

  const { clientes, vendas, ...conta } = resultadoConta.data as any;

  const pagamentos = await listarPagamentos(id);

  return {
    conta: {
      ...conta,
      cliente_nome: clientes?.nome ?? "—",
      venda_created_at: vendas?.created_at ?? conta.created_at,
    },
    cliente: clientes,
    pagamentos,
  };
}

export async function listarPagamentos(contaReceberId: string): Promise<Recebimento[]> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase
    .from("recebimentos")
    .select("*")
    .eq("conta_receber_id", contaReceberId)
    .order("created_at", { ascending: false });

  return unwrap(resultado, "Erro ao listar pagamentos");
}

export interface DadosPagamento {
  contaReceberId: string;
  valor: number;
  formaPagamento: string;
  funcionarioId: string;
  observacoes?: string | null;
}

export interface ResultadoPagamento {
  saldoAtual: number;
  status: StatusConta;
}

export async function registrarPagamento(dados: DadosPagamento): Promise<ResultadoPagamento> {
  const supabase = await createSupabaseServerClient();
  const resultado = await supabase.rpc("registrar_pagamento_conta", {
    p_conta_receber_id: dados.contaReceberId,
    p_valor: dados.valor,
    p_forma_pagamento: dados.formaPagamento,
    p_funcionario_id: dados.funcionarioId,
    p_observacoes: dados.observacoes ?? null,
  });

  const retorno = unwrap(resultado, "Erro ao registrar pagamento") as { saldo_atual: number; status: StatusConta };
  return { saldoAtual: retorno.saldo_atual, status: retorno.status };
}

export interface ContaReceberPendente extends ContaReceberComCliente {
  dias_em_aberto: number;
}

export async function listarContasPendentes(): Promise<ContaReceberPendente[]> {
  const todas = await listarContas();
  const agora = Date.now();

  return todas
    .filter((c) => c.status !== "QUITADA")
    .map((c) => ({
      ...c,
      dias_em_aberto: Math.floor((agora - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24)),
    }))
    .sort((a, b) => b.dias_em_aberto - a.dias_em_aberto);
}

export function calcularSaldo(valorOriginal: number, pagamentos: Recebimento[]): number {
  const totalPago = pagamentos.reduce((soma, p) => soma + p.valor, 0);
  return Math.max(0, valorOriginal - totalPago);
}