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
    .select("*, clientes(nome, telefone), vendas(created_at)")
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
      cliente_telefone: clientes?.telefone ?? null,
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
      cliente_telefone: clientes?.telefone ?? null,
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

export interface Devedor {
  cliente_id: string;
  cliente_nome: string;
  cliente_telefone: string | null;
  primeira_compra_em_aberto: string;
  ultima_compra: string;
  saldo_atual: number;
  dias_em_aberto: number;
  status: StatusConta;
}

export async function listarDevedores(): Promise<Devedor[]> {
  const todasContas = await listarContas();

  const porCliente = new Map<string, ContaReceberComCliente[]>();
  for (const conta of todasContas) {
    const lista = porCliente.get(conta.cliente_id) ?? [];
    lista.push(conta);
    porCliente.set(conta.cliente_id, lista);
  }

  const agora = Date.now();
  const devedores: Devedor[] = [];

  for (const [clienteId, contas] of porCliente) {
    const abertas = contas.filter((c) => c.status !== "QUITADA");
    const saldoAtual = abertas.reduce((s, c) => s + c.saldo_atual, 0);
    const temAberta = abertas.some((c) => c.status === "ABERTA");
    const status: StatusConta = abertas.length === 0 ? "QUITADA" : temAberta ? "ABERTA" : "PARCIAL";

    const referenciaPrimeiraCompra = abertas.length > 0 ? abertas : contas;
    const maisAntiga = referenciaPrimeiraCompra.reduce((antiga, c) =>
      new Date(c.created_at) < new Date(antiga.created_at) ? c : antiga
    );
    const maisRecente = contas.reduce((recente, c) =>
      new Date(c.venda_created_at) > new Date(recente.venda_created_at) ? c : recente
    );

    devedores.push({
      cliente_id: clienteId,
      cliente_nome: contas[0].cliente_nome,
      cliente_telefone: contas[0].cliente_telefone,
      primeira_compra_em_aberto: maisAntiga.created_at,
      ultima_compra: maisRecente.venda_created_at,
      saldo_atual: saldoAtual,
      dias_em_aberto:
        status === "QUITADA" ? 0 : Math.floor((agora - new Date(maisAntiga.created_at).getTime()) / 86400000),
      status,
    });
  }

  return devedores;
}

export interface EventoLinhaDoTempo {
  tipo: "compra" | "pagamento";
  data: string;
  descricao: string;
  valor: number;
}

export interface DetalheCliente {
  cliente: Cliente;
  comprasEmAberto: ContaReceberComCliente[];
  comprasQuitadas: ContaReceberComCliente[];
  pagamentos: (Recebimento & { conta_receber_id: string })[];
  saldoTotal: number;
  linhaDoTempo: EventoLinhaDoTempo[];
}

export async function buscarDetalheCliente(clienteId: string): Promise<DetalheCliente | null> {
  const supabase = await createSupabaseServerClient();

  const resultadoCliente = await supabase.from("clientes").select("*").eq("id", clienteId).single();
  if (resultadoCliente.error || !resultadoCliente.data) return null;

  const todasContas = await listarContas();
  const contasDoCliente = todasContas.filter((c) => c.cliente_id === clienteId);

  const comprasEmAberto = contasDoCliente.filter((c) => c.status !== "QUITADA");
  const comprasQuitadas = contasDoCliente.filter((c) => c.status === "QUITADA");
  const saldoTotal = comprasEmAberto.reduce((s, c) => s + c.saldo_atual, 0);

  const pagamentosPorConta = await Promise.all(
    contasDoCliente.map(async (c) => {
      const pagamentos = await listarPagamentos(c.id);
      return pagamentos.map((p) => ({ ...p, conta_receber_id: c.id }));
    })
  );
  const pagamentos = pagamentosPorConta.flat();

  const linhaDoTempo: EventoLinhaDoTempo[] = [
    ...contasDoCliente.map((c) => ({
      tipo: "compra" as const,
      data: c.venda_created_at,
      descricao: `Compra fiado — R$ ${c.valor_original.toFixed(2)}`,
      valor: c.valor_original,
    })),
    ...pagamentos.map((p) => ({
      tipo: "pagamento" as const,
      data: p.created_at,
      descricao: `Pagamento (${p.forma_pagamento})`,
      valor: p.valor,
    })),
  ].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

  return {
    cliente: resultadoCliente.data as Cliente,
    comprasEmAberto,
    comprasQuitadas,
    pagamentos,
    saldoTotal,
    linhaDoTempo,
  };
}

export interface ResumoFinanceiroContasReceber {
  valorTotalEmAberto: number;
  quantidadeClientesDevedores: number;
  quantidadeContasVencidas: number;
  quantidadeContasProximasVencimento: number;
  valorRecebidoNoMes: number;
  valorRecebidoHoje: number;
}

export async function buscarResumoFinanceiro(): Promise<ResumoFinanceiroContasReceber> {
  const pendentes = await listarContasPendentes();
  const valorTotalEmAberto = pendentes.reduce((s, c) => s + c.saldo_atual, 0);
  const clientesUnicos = new Set(pendentes.map((c) => c.cliente_id));
  const quantidadeContasVencidas = pendentes.filter((c) => c.dias_em_aberto > 30).length;
  const quantidadeContasProximasVencimento = pendentes.filter(
    (c) => c.dias_em_aberto >= 16 && c.dias_em_aberto <= 30
  ).length;

  const supabase = await createSupabaseServerClient();
  const inicioDoMes = new Date();
  inicioDoMes.setDate(1);
  inicioDoMes.setHours(0, 0, 0, 0);
  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);

  const resultado = await supabase
    .from("recebimentos")
    .select("valor, created_at")
    .gte("created_at", inicioDoMes.toISOString());

  const pagamentosDoMes = unwrap(resultado, "Erro ao buscar recebimentos do mês") as {
    valor: number;
    created_at: string;
  }[];

  const valorRecebidoNoMes = pagamentosDoMes.reduce((s, p) => s + p.valor, 0);
  const valorRecebidoHoje = pagamentosDoMes
    .filter((p) => new Date(p.created_at) >= inicioDoDia)
    .reduce((s, p) => s + p.valor, 0);

  return {
    valorTotalEmAberto,
    quantidadeClientesDevedores: clientesUnicos.size,
    quantidadeContasVencidas,
    quantidadeContasProximasVencimento,
    valorRecebidoNoMes,
    valorRecebidoHoje,
  };
}