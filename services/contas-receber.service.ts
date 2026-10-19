import { Prisma } from "@prisma/client";
import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";
import { buscarCliente } from "./clientes.service";
import { ContaReceber, ContaReceberComCliente, Recebimento, StatusConta } from "@/types/conta-receber";
import { Cliente } from "@/types/cliente";

const LIMITE_LISTAGEM = 500;

export interface DadosContaReceber {
  cliente_id: string;
  venda_id: string;
  valor_original: number;
}

export async function criarContaReceber(dados: DadosContaReceber): Promise<ContaReceber> {
  return executar(
    () => prisma.contaReceber.create({ data: { ...dados, saldo_atual: dados.valor_original, status: "ABERTA" } }),
    "Erro ao criar conta a receber"
  );
}

export async function listarContas(status?: StatusConta, clienteId?: string): Promise<ContaReceberComCliente[]> {
  const linhas = await executar<any[]>(
    () =>
      prisma.contaReceber.findMany({
        include: { cliente: { select: { nome: true, telefone: true } }, venda: { select: { created_at: true } } },
        where: { ...(status && { status }), ...(clienteId && { cliente_id: clienteId }) },
        orderBy: { created_at: "desc" },
        take: LIMITE_LISTAGEM,
      }),
    "Erro ao listar contas a receber"
  );

  return linhas.map((l) => {
    const { cliente, venda, ...conta } = l;
    return {
      ...conta,
      cliente_nome: cliente?.nome ?? "—",
      cliente_telefone: cliente?.telefone ?? null,
      venda_created_at: venda?.created_at ?? conta.created_at,
    };
  });
}

export interface DetalheContaReceber {
  conta: ContaReceberComCliente;
  cliente: Cliente;
  pagamentos: Recebimento[];
}

export async function buscarConta(id: string): Promise<DetalheContaReceber | null> {
  let registro: any;
  try {
    registro = await executar<any>(
      () =>
        prisma.contaReceber.findUnique({
          where: { id },
          include: { cliente: true, venda: { select: { created_at: true } } },
        }),
      "Erro ao buscar conta a receber"
    );
  } catch {
    return null;
  }

  if (!registro) return null;

  const { cliente, venda, ...conta } = registro;

  const pagamentos = await listarPagamentos(id);

  return {
    conta: {
      ...conta,
      cliente_nome: cliente?.nome ?? "—",
      cliente_telefone: cliente?.telefone ?? null,
      venda_created_at: venda?.created_at ?? conta.created_at,
    },
    cliente,
    pagamentos,
  };
}

export async function listarPagamentos(contaReceberId: string): Promise<Recebimento[]> {
  return executar(
    () =>
      prisma.recebimento.findMany({
        where: { conta_receber_id: contaReceberId },
        orderBy: { created_at: "desc" },
      }),
    "Erro ao listar pagamentos"
  );
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
  // Equivalente à antiga função SQL registrar_pagamento_conta: trava a conta,
  // grava o recebimento e recalcula saldo/status numa única transação.
  return executar(
    () =>
      prisma.$transaction(async (tx) => {
        const [conta] = await tx.$queryRaw<{ saldo_atual: Prisma.Decimal }[]>`
          SELECT saldo_atual FROM contas_receber WHERE id = ${dados.contaReceberId}::uuid FOR UPDATE`;

        if (!conta) throw new Error("Conta a receber não encontrada.");

        const valor = new Prisma.Decimal(dados.valor);
        if (valor.lte(0)) throw new Error("O valor do pagamento deve ser maior que zero.");
        if (valor.gt(conta.saldo_atual)) throw new Error("O valor do pagamento é maior que o saldo da conta.");

        await tx.recebimento.create({
          data: {
            conta_receber_id: dados.contaReceberId,
            valor,
            forma_pagamento: dados.formaPagamento,
            funcionario_id: dados.funcionarioId,
            observacoes: dados.observacoes ?? null,
          },
        });

        const novoSaldo = conta.saldo_atual.minus(valor);
        const status: StatusConta = novoSaldo.isZero() ? "QUITADA" : "PARCIAL";
        await tx.contaReceber.update({
          where: { id: dados.contaReceberId },
          data: { saldo_atual: novoSaldo, status },
        });

        return { saldoAtual: novoSaldo, status };
      }),
    "Erro ao registrar pagamento"
  );
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
  const cliente = await buscarCliente(clienteId);
  if (!cliente) return null;

  const contasDoCliente = await listarContas(undefined, clienteId);

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
    cliente,
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

export async function buscarResumoFinanceiro(
  pendentes: ContaReceberPendente[]
): Promise<ResumoFinanceiroContasReceber> {
  const valorTotalEmAberto = pendentes.reduce((s, c) => s + c.saldo_atual, 0);
  const clientesUnicos = new Set(pendentes.map((c) => c.cliente_id));
  const quantidadeContasVencidas = pendentes.filter((c) => c.dias_em_aberto > 30).length;
  const quantidadeContasProximasVencimento = pendentes.filter(
    (c) => c.dias_em_aberto >= 16 && c.dias_em_aberto <= 30
  ).length;

  const inicioDoMes = new Date();
  inicioDoMes.setDate(1);
  inicioDoMes.setHours(0, 0, 0, 0);
  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);

  const pagamentosDoMes = await executar<{ valor: number; created_at: string }[]>(
    () =>
      prisma.recebimento.findMany({
        select: { valor: true, created_at: true },
        where: { created_at: { gte: inicioDoMes } },
      }),
    "Erro ao buscar recebimentos do mês"
  );

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