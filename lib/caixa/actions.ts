"use server";

import { verificarAcesso } from "@/lib/auth/servidor";
import { autorizarPorPin } from "@/lib/auth/autorizacao";
import {
  abrirCaixa,
  conferirCaixa,
  estornar,
  fecharCaixa,
  listarConflitos,
  permissaoDoEscopo,
  reabrirCaixa,
  registrarAutorizacao,
  registrarConflito,
  registrarMovimentoAvulso,
  tratarConflito,
  type Autoria,
  type EntradaAbertura,
  type EntradaEstorno,
  type EntradaFechamento,
  type EntradaMovimentoAvulso,
  validarEscopoAutorizacao,
  type EscopoAutorizacao,
  type ResultadoOperacao,
} from "@/services/caixa.service";
import {
  dadosRelatorioCaixa,
  detalheCaixa,
  listarCaixas,
  listarTerminais,
  type DadosRelatorioCaixa,
  type DetalheCaixa,
  type CaixaListado,
  type FiltroCaixas,
} from "@/services/caixa-consulta.service";
import { prisma } from "@/services/prisma/client";
import { origemOk, textoLimpo, uuidOk } from "@/lib/caixa/validacao";

/**
 * Server Actions do caixa. Duas famílias:
 *  1. `sincronizarOperacaoCaixaAction`: recebe as operações que o aparelho gravou localmente (inclusive
 *     offline) e as aplica de forma IDEMPOTENTE. O PIN nunca viaja nesta fila: o aparelho envia só o
 *     id do funcionário identificado, e o servidor REVALIDA existência, situação e permissão.
 *  2. Ações administrativas (consulta, reabertura, conferência): exigem papel de administrador; as que
 *     alteram dados também exigem o PIN do funcionário autorizador (online).
 */

export type OperacaoCaixa =
  | { tipo: "abertura"; id: string; funcionario_id: string; dispositivo: string; origem: string; dados: EntradaAbertura }
  | { tipo: "movimento"; id: string; funcionario_id: string; dispositivo: string; origem: string; dados: EntradaMovimentoAvulso }
  | { tipo: "estorno"; id: string; funcionario_id: string; dispositivo: string; origem: string; dados: EntradaEstorno }
  | { tipo: "fechamento"; id: string; funcionario_id: string; dispositivo: string; origem: string; dados: EntradaFechamento };

export interface ResultadoSincronizarCaixa {
  sucesso: boolean;
  jaExistia?: boolean;
  erro?: string;
  /** Sessão expirada: a operação continua na fila local. */
  requerLogin?: boolean;
  /** Depende de outra operação ainda não sincronizada (ex.: abertura): tentar de novo, sem contar falha. */
  aguardando?: boolean;
  /** O servidor não aplicou, mas PRESERVOU a operação para tratamento explícito do administrador. */
  conflito?: boolean;
  motivo?: string;
  /** Fechamento: resumo oficial calculado pelo servidor. */
  fechamento?: unknown;
}

export async function sincronizarOperacaoCaixaAction(op: OperacaoCaixa): Promise<ResultadoSincronizarCaixa> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro, requerLogin: true };

  if (!op || !uuidOk(op.id) || !uuidOk(op.funcionario_id) || !textoLimpo(op.dispositivo, 80) || !origemOk(op.origem)) {
    return { sucesso: false, erro: "Operação de caixa inválida." };
  }
  const autoria: Autoria = {
    funcionario_id: op.funcionario_id,
    usuario_id: acesso.sessao.usuario.id,
    dispositivo: op.dispositivo,
    origem: op.origem,
  };

  // Sangria, suprimento, despesa, ajuste e estorno são operações ADMINISTRATIVAS: o funcionario_id enviado pelo
  // aparelho não prova nada. Dentro da transação da operação (services/caixa.service.ts) a autorização emitida por
  // autorizarOperacaoCaixaAction é CONSUMIDA de forma atômica — funcionário, login, permissão, escopo, validade e
  // uso único. Reenvio de operação já aplicada devolve o resultado anterior sem consumir nada.

  let r: ResultadoOperacao;
  try {
    switch (op.tipo) {
      case "abertura":
        r = await abrirCaixa({ ...op.dados, id: op.id }, autoria);
        break;
      case "movimento":
        r = await registrarMovimentoAvulso({ ...op.dados, id: op.id }, autoria);
        break;
      case "estorno":
        r = await estornar({ ...op.dados, id: op.id }, autoria);
        break;
      case "fechamento":
        r = await fecharCaixa({ ...op.dados, exigirJustificativa: false }, autoria);
        break;
      default:
        return { sucesso: false, erro: "Tipo de operação de caixa desconhecido." };
    }
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }

  switch (r.status) {
    case "ok":
      return { sucesso: true, jaExistia: r.jaExistia, fechamento: op.tipo === "fechamento" ? r.detalhe : undefined };
    case "aguardando":
      return { sucesso: false, aguardando: true, motivo: r.motivo, erro: r.motivo };
    case "conflito":
    case "rejeitado": {
      const motivo = r.status === "conflito" ? r.motivo : r.erro;
      await registrarConflito({
        id: op.id,
        tipo: op.tipo,
        caixa_id: op.tipo === "abertura" ? op.id : (op.dados as { caixa_id?: string }).caixa_id,
        dispositivo: op.dispositivo,
        usuario_id: acesso.sessao.usuario.id,
        payload: op,
        motivo,
      });
      return { sucesso: false, conflito: true, motivo, erro: motivo };
    }
  }
}

/**
 * Valida o PIN NO SERVIDOR para uma operação administrativa e registra a autorização presa ao funcionário,
 * à operação e aos valores. Exige conexão (o PIN de proprietário/gerente nunca sai do servidor).
 */
export async function autorizarOperacaoCaixaAction(
  escopo: EscopoAutorizacao,
  pin: string
): Promise<{ sucesso: boolean; funcionario?: { id: string; nome: string }; erro?: string; erroAutorizacao?: string }> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
  const invalido = await validarEscopoAutorizacao(escopo);
  if (invalido) return { sucesso: false, erro: invalido };
  const auth = await autorizarPorPin(pin, permissaoDoEscopo(escopo));
  if (!auth.ok) return { sucesso: false, erro: auth.erro, erroAutorizacao: auth.erro };
  if (!(await registrarAutorizacao(escopo, auth.funcionario.id, acesso.sessao.usuario.id))) {
    return { sucesso: false, erro: "Esta operação já foi autorizada e executada." };
  }
  return { sucesso: true, funcionario: { id: auth.funcionario.id, nome: auth.funcionario.nome } };
}

// ---------------------------------------------------------------------------
// Administração
// ---------------------------------------------------------------------------

export async function listarCaixasAction(filtro: FiltroCaixas): Promise<CaixaListado[]> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) throw new Error(acesso.erro);
  return listarCaixas(filtro ?? {});
}

export async function detalheCaixaAction(id: string): Promise<DetalheCaixa | null> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) throw new Error(acesso.erro);
  if (!uuidOk(id)) return null;
  return detalheCaixa(id);
}

export async function relatorioCaixaAction(filtro: FiltroCaixas): Promise<DadosRelatorioCaixa> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) throw new Error(acesso.erro);
  return dadosRelatorioCaixa(filtro ?? {});
}

export async function listarTerminaisAction(): Promise<{ terminal_id: string; terminal_papel: string | null; ultimo_uso: string }[]> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) throw new Error(acesso.erro);
  return listarTerminais();
}

export interface ResultadoAcaoAdminCaixa {
  sucesso: boolean;
  erro?: string;
  /** PIN recusado (errado, bloqueado ou sem permissão) — o pedido de PIN continua aberto. */
  erroAutorizacao?: string;
}

export async function reabrirCaixaAction(caixaId: string, justificativa: string, pin: string): Promise<ResultadoAcaoAdminCaixa> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
  const auth = await autorizarPorPin(pin, "caixa.reabrir");
  if (!auth.ok) return { sucesso: false, erro: auth.erro, erroAutorizacao: auth.erro };
  const r = await reabrirCaixa(
    { caixa_id: caixaId, justificativa },
    { funcionario_id: auth.funcionario.id, usuario_id: acesso.sessao.usuario.id, dispositivo: "painel-administrativo", origem: "online" }
  );
  return r.ok ? { sucesso: true } : { sucesso: false, erro: r.erro };
}

export async function conferirCaixaAction(caixaId: string, observacao: string, pin: string): Promise<ResultadoAcaoAdminCaixa> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
  const auth = await autorizarPorPin(pin, "caixa.consultar");
  if (!auth.ok) return { sucesso: false, erro: auth.erro, erroAutorizacao: auth.erro };
  const r = await conferirCaixa({ caixa_id: caixaId, observacao }, { usuario_id: acesso.sessao.usuario.id, funcionario_id: auth.funcionario.id });
  return r.ok ? { sucesso: true } : { sucesso: false, erro: r.erro };
}

/** Recebimento de conta a receber lançado pelo SERVIDOR no caixa deste terminal (o aparelho não o conhece). */
export interface RecebimentoDoCaixa {
  id: string;
  forma_pagamento: string;
  valor_centavos: number;
  funcionario_id: string;
  funcionario_nome: string;
  descricao: string | null;
  ocorrido_em: string;
}

/**
 * Leitura: os recebimentos de contas a receber que o servidor lançou no caixa de ESTE terminal. Só existem online (a
 * conta é paga no servidor) e fazem parte do saldo esperado; sem eles o aparelho calcularia o dinheiro esperado a menos.
 * Só devolve se o caixa pertencer ao terminal informado.
 */
export async function recebimentosDoCaixaAction(caixaId: string, terminalId: string): Promise<{ sucesso: boolean; itens: RecebimentoDoCaixa[] }> {
  const acesso = await verificarAcesso();
  if (!acesso.ok || !uuidOk(caixaId) || !textoLimpo(terminalId, 80)) return { sucesso: false, itens: [] };
  const caixa = await prisma.caixa.findUnique({ where: { id: caixaId }, select: { terminal_id: true } });
  if (!caixa || caixa.terminal_id !== terminalId) return { sucesso: false, itens: [] };
  const linhas = await prisma.movimentoCaixa.findMany({
    where: { caixa_id: caixaId, tipo: "recebimento_conta" },
    orderBy: { ocorrido_em: "asc" },
    select: { id: true, forma_pagamento: true, valor_centavos: true, funcionario_id: true, descricao: true, ocorrido_em: true, funcionario: { select: { nome: true } } },
  });
  return {
    sucesso: true,
    itens: linhas.map((l) => ({
      id: l.id,
      forma_pagamento: l.forma_pagamento,
      valor_centavos: l.valor_centavos,
      funcionario_id: l.funcionario_id,
      funcionario_nome: l.funcionario.nome,
      descricao: l.descricao,
      ocorrido_em: l.ocorrido_em.toISOString(),
    })),
  };
}

export async function listarConflitosCaixaAction(status: "pendente" | "tratado") {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) throw new Error(acesso.erro);
  const linhas = await listarConflitos(status === "tratado" ? "tratado" : "pendente");
  return linhas.map((l) => ({
    id: l.id, tipo: l.tipo, caixa_id: l.caixa_id, dispositivo: l.dispositivo, motivo: l.motivo, status: l.status,
    observacao: l.observacao, created_at: l.created_at.toISOString(), payload: l.payload as unknown,
  }));
}

export async function tratarConflitoCaixaAction(id: string, observacao: string): Promise<ResultadoAcaoAdminCaixa> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };
  if (!uuidOk(id)) return { sucesso: false, erro: "Conflito inválido." };
  const ok = await tratarConflito(id, acesso.sessao.usuario.id, observacao);
  return ok ? { sucesso: true } : { sucesso: false, erro: "Conflito não encontrado, já tratado ou sem observação." };
}
