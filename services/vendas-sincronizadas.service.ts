import { Prisma } from "@prisma/client";
import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";
import { gravarVendaNaTransacao, registrarVenda } from "./vendas.service";
import {
  avaliarVendaContraReferencia,
  possuiMotivoBloqueante,
  validarEstruturaVenda,
  uuidValido,
  type MotivoRevisao,
  type ReferenciaVenda,
  type VendaRecebida,
} from "@/lib/vendas/validacao-sincronizacao";
import type { Cargo } from "@/types/funcionario";

/**
 * Porta de entrada de toda venda vinda do navegador (fila offline ou PDV online).
 * O servidor NÃO confia no payload: confere estrutura, funcionário, cliente, preços
 * e total contra o banco. Se tudo confere, grava (idempotente, transacional). Se algo
 * não confere, a venda fica RETIDA em `vendas_revisao` com os motivos — nunca é
 * descartada e nunca entra no faturamento/estoque até um administrador aprovar.
 */

export type ResultadoProcessamentoVenda =
  | { status: "registrada"; jaExistia: boolean }
  | { status: "em_revisao"; motivos: MotivoRevisao[]; bloqueante: boolean }
  | { status: "rejeitada"; observacao: string | null }
  /** Payload sem identificador utilizável: não há como retê-lo no servidor. */
  | { status: "invalida"; motivos: MotivoRevisao[] };

function payloadLimpo(p: VendaRecebida) {
  // Só os campos conhecidos (e o que será gravado), para a revisão não carregar lixo arbitrário.
  return {
    funcionario_id: p.funcionario_id,
    forma_pagamento: p.forma_pagamento,
    total: p.total ?? null,
    dispositivo: typeof p.dispositivo === "string" ? p.dispositivo.slice(0, 300) : null,
    terminal: typeof p.terminal === "string" ? p.terminal.slice(0, 40) : null,
    cliente_id: p.cliente_id ?? null,
    itens: Array.isArray(p.itens)
      ? p.itens.slice(0, 500).map((i) => ({
          produto_id: i?.produto_id,
          quantidade: i?.quantidade,
          preco_unitario: i?.preco_unitario,
        }))
      : [],
  };
}

type LeitorBanco = Pick<typeof prisma, "funcionario" | "cliente" | "produto">;

async function carregarReferencia(venda: VendaRecebida, banco: LeitorBanco = prisma): Promise<ReferenciaVenda> {
  const idsProdutos = [...new Set(venda.itens.map((i) => i.produto_id))];
  const [funcionario, cliente, produtos] = await Promise.all([
    banco.funcionario.findUnique({
      where: { id: venda.funcionario_id },
      select: { ativo: true, deleted_at: true, cargo: true },
    }),
    venda.cliente_id
      ? banco.cliente.findUnique({ where: { id: venda.cliente_id }, select: { ativo: true, deleted_at: true } })
      : Promise.resolve(undefined),
    banco.produto.findMany({
      where: { id: { in: idsProdutos } },
      select: { id: true, preco_venda: true, ativo: true, deleted_at: true },
    }),
  ]);

  return {
    funcionario: funcionario && {
      ativo: funcionario.ativo,
      deleted: funcionario.deleted_at !== null,
      cargo: funcionario.cargo as Cargo,
    },
    cliente: cliente === undefined ? undefined : cliente && { ativo: cliente.ativo, deleted: cliente.deleted_at !== null },
    produtos: new Map(
      produtos.map((p) => [p.id, { preco_venda: p.preco_venda.toNumber(), ativo: p.ativo, deleted: p.deleted_at !== null }])
    ),
  };
}

async function reter(
  id: string,
  usuarioId: string | null,
  venda: VendaRecebida,
  motivos: MotivoRevisao[]
): Promise<ResultadoProcessamentoVenda> {
  const bloqueante = possuiMotivoBloqueante(motivos);
  try {
    await prisma.vendaRevisao.create({
      data: {
        id,
        usuario_id: usuarioId,
        funcionario_id: typeof venda.funcionario_id === "string" ? venda.funcionario_id.slice(0, 80) : null,
        payload: payloadLimpo(venda) as Prisma.InputJsonValue,
        motivos: motivos as unknown as Prisma.InputJsonValue,
        bloqueante,
      },
    });
  } catch (e) {
    // Reenvio (ou envio simultâneo) do mesmo id: já está retida — idempotente.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
  }
  return { status: "em_revisao", motivos, bloqueante };
}

export async function processarVendaRecebida(
  id: string,
  payload: unknown,
  usuarioId: string
): Promise<ResultadoProcessamentoVenda> {
  const motivosEstrutura = validarEstruturaVenda(id, payload);
  if (!uuidValido(id) || typeof payload !== "object" || payload === null) {
    return { status: "invalida", motivos: motivosEstrutura };
  }

  // Idempotência: já gravada, ou já retida/decidida.
  const jaVenda = await prisma.venda.findUnique({ where: { id }, select: { id: true } });
  if (jaVenda) return { status: "registrada", jaExistia: true };

  const retida = await prisma.vendaRevisao.findUnique({ where: { id } });
  if (retida) {
    if (retida.status === "rejeitada") return { status: "rejeitada", observacao: retida.observacao };
    return { status: "em_revisao", motivos: retida.motivos as unknown as MotivoRevisao[], bloqueante: retida.bloqueante };
  }

  const venda = payload as VendaRecebida;
  if (possuiMotivoBloqueante(motivosEstrutura)) return reter(id, usuarioId, venda, motivosEstrutura);

  const motivos = avaliarVendaContraReferencia(venda, await carregarReferencia(venda));
  if (motivos.length > 0) return reter(id, usuarioId, venda, motivos);

  const resultado = await registrarVenda({
    id,
    funcionario_id: venda.funcionario_id,
    usuario_id: usuarioId,
    forma_pagamento: venda.forma_pagamento,
    dispositivo: venda.dispositivo,
    cliente_id: venda.cliente_id,
    itens: venda.itens.map((i) => ({ produto_id: i.produto_id, nome: "", quantidade: i.quantidade, preco_unitario: i.preco_unitario })),
  });
  return { status: "registrada", jaExistia: resultado.jaExistia };
}

// ---------------------------------------------------------------------------
// Revisão pelo administrador
// ---------------------------------------------------------------------------

export interface VendaEmRevisao {
  id: string;
  status: "pendente" | "aprovada" | "rejeitada";
  bloqueante: boolean;
  motivos: MotivoRevisao[];
  enviada_por: string | null;
  funcionario_nome: string | null;
  forma_pagamento: string;
  total_informado: number;
  criada_em: string;
  decidida_em: string | null;
  observacao: string | null;
  itens: { produto_nome: string; quantidade: number; preco_informado: number; preco_cadastrado: number | null }[];
}

export async function listarVendasEmRevisao(status: "pendente" | "aprovada" | "rejeitada" = "pendente"): Promise<VendaEmRevisao[]> {
  return executar(async () => {
    const linhas = await prisma.vendaRevisao.findMany({
      where: { status },
      orderBy: { created_at: "asc" },
      take: 200,
      include: { usuario: { select: { nome: true, email: true } } },
    });

    const payloads = linhas.map((l) => l.payload as unknown as VendaRecebida);
    const idsProdutos = [...new Set(payloads.flatMap((p) => (p.itens ?? []).map((i) => i.produto_id).filter(uuidValido)))];
    const idsFuncionarios = [...new Set(payloads.map((p) => p.funcionario_id).filter(uuidValido))];
    const [produtos, funcionarios] = await Promise.all([
      prisma.produto.findMany({ where: { id: { in: idsProdutos } }, select: { id: true, nome: true, preco_venda: true } }),
      prisma.funcionario.findMany({ where: { id: { in: idsFuncionarios } }, select: { id: true, nome: true } }),
    ]);
    const mapaProdutos = new Map(produtos.map((p) => [p.id, p]));
    const mapaFuncionarios = new Map(funcionarios.map((f) => [f.id, f.nome]));

    return linhas.map((l, idx): VendaEmRevisao => {
      const p = payloads[idx];
      const itens = (p.itens ?? []).map((i) => {
        const produto = mapaProdutos.get(i.produto_id);
        return {
          produto_nome: produto?.nome ?? "(produto desconhecido)",
          quantidade: Number(i.quantidade),
          preco_informado: Number(i.preco_unitario),
          preco_cadastrado: produto ? produto.preco_venda.toNumber() : null,
        };
      });
      return {
        id: l.id,
        status: l.status as VendaEmRevisao["status"],
        bloqueante: l.bloqueante,
        motivos: l.motivos as unknown as MotivoRevisao[],
        enviada_por: l.usuario ? `${l.usuario.nome} (${l.usuario.email})` : null,
        funcionario_nome: mapaFuncionarios.get(p.funcionario_id) ?? null,
        forma_pagamento: String(p.forma_pagamento),
        total_informado: itens.reduce((s, i) => s + i.preco_informado * i.quantidade, 0),
        criada_em: l.created_at.toISOString(),
        decidida_em: l.decidido_em?.toISOString() ?? null,
        observacao: l.observacao,
        itens,
      };
    });
  }, "Erro ao listar vendas em revisão");
}

export type ResultadoDecisao = { ok: true } | { ok: false; erro: string };

/**
 * Aprova: grava a venda com os valores informados (a exceção, autorizada por um
 * administrador) na mesma transação que marca a revisão como aprovada. Antes, a
 * estrutura e a existência de funcionário/produtos são conferidas de novo.
 */
export async function aprovarVendaEmRevisao(id: string, adminId: string, observacao?: string): Promise<ResultadoDecisao> {
  try {
    return await prisma.$transaction(
      async (tx): Promise<ResultadoDecisao> => {
        const linhas = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM vendas_revisao WHERE id = ${id}::uuid FOR UPDATE`;
        if (linhas.length === 0) return { ok: false, erro: "Venda em revisão não encontrada." };

        const revisao = await tx.vendaRevisao.findUniqueOrThrow({ where: { id } });
        if (revisao.status !== "pendente") return { ok: false, erro: "Esta venda já foi decidida." };
        if (revisao.bloqueante) return { ok: false, erro: "Esta venda tem problemas que impedem a aprovação (dados inválidos)." };

        const venda = revisao.payload as unknown as VendaRecebida;

        // Revalida TUDO com os dados de AGORA (não os do momento em que a venda foi retida).
        const estrutura = validarEstruturaVenda(id, venda);
        if (possuiMotivoBloqueante(estrutura)) return { ok: false, erro: "Os dados da venda são inválidos e ela não pode ser aprovada." };
        const atuais = avaliarVendaContraReferencia(venda, await carregarReferencia(venda, tx));

        if (possuiMotivoBloqueante(atuais)) {
          await tx.vendaRevisao.update({ where: { id }, data: { motivos: atuais as unknown as Prisma.InputJsonValue, bloqueante: true } });
          return { ok: false, erro: "A venda não pode mais ser aprovada: " + atuais.filter((m) => m.gravidade === "bloqueante").map((m) => m.mensagem).join(" ") };
        }

        // O administrador aprova O QUE VIU. Se os motivos mudaram desde então (ex.: o preço
        // cadastrado foi alterado de novo), nada é aprovado: a tela é atualizada para uma nova decisão.
        const assinatura = (motivos: MotivoRevisao[]) => motivos.map((m) => `${m.codigo}|${m.item ?? ""}|${m.mensagem}`).sort().join("#");
        if (assinatura(atuais) !== assinatura(revisao.motivos as unknown as MotivoRevisao[])) {
          await tx.vendaRevisao.update({ where: { id }, data: { motivos: atuais as unknown as Prisma.InputJsonValue } });
          return { ok: false, erro: "Os dados mudaram desde que a venda foi retida. Recarregue a página, confira os motivos atualizados e decida de novo." };
        }

        await gravarVendaNaTransacao(tx, {
          id,
          funcionario_id: venda.funcionario_id,
          usuario_id: revisao.usuario_id,
          forma_pagamento: venda.forma_pagamento,
          dispositivo: venda.dispositivo,
          cliente_id: venda.cliente_id,
          itens: venda.itens.map((i) => ({ produto_id: i.produto_id, nome: "", quantidade: i.quantidade, preco_unitario: i.preco_unitario })),
        });

        await tx.vendaRevisao.update({
          where: { id },
          data: { status: "aprovada", decidido_por: adminId, decidido_em: new Date(), observacao: observacao?.slice(0, 500) ?? null },
        });
        return { ok: true };
      },
      { timeout: 15000 }
    );
  } catch (e) {
    return { ok: false, erro: `Erro ao aprovar a venda: ${(e as Error).message}` };
  }
}

/** Rejeita (a venda NÃO entra no faturamento nem no estoque). O registro permanece para auditoria. */
export async function rejeitarVendaEmRevisao(id: string, adminId: string, observacao?: string): Promise<ResultadoDecisao> {
  const { count } = await prisma.vendaRevisao.updateMany({
    where: { id, status: "pendente" },
    data: { status: "rejeitada", decidido_por: adminId, decidido_em: new Date(), observacao: observacao?.slice(0, 500) ?? null },
  });
  return count === 1 ? { ok: true } : { ok: false, erro: "Venda não encontrada ou já decidida." };
}

export async function contarVendasEmRevisaoPendentes(): Promise<number> {
  return prisma.vendaRevisao.count({ where: { status: "pendente" } });
}
