"use server";

import { revalidatePath } from "next/cache";
import { verificarAcesso } from "@/lib/auth/servidor";
import { aprovarVendaEmRevisao, contarVendasEmRevisaoPendentes, rejeitarVendaEmRevisao } from "@/services/vendas-sincronizadas.service";

export interface ResultadoDecisaoRevisao {
  sucesso: boolean;
  erro?: string;
}

// Decidir sobre uma venda retida é uma autorização de exceção: só administrador, verificado no servidor.

export async function aprovarVendaRevisaoAction(id: string, observacao?: string): Promise<ResultadoDecisaoRevisao> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };

  const resultado = await aprovarVendaEmRevisao(id, acesso.sessao.usuario.id, observacao);
  if (!resultado.ok) return { sucesso: false, erro: resultado.erro };
  revalidatePath("/vendas-revisao");
  return { sucesso: true };
}

export async function rejeitarVendaRevisaoAction(id: string, observacao?: string): Promise<ResultadoDecisaoRevisao> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro };

  const resultado = await rejeitarVendaEmRevisao(id, acesso.sessao.usuario.id, observacao);
  if (!resultado.ok) return { sucesso: false, erro: resultado.erro };
  revalidatePath("/vendas-revisao");
  return { sucesso: true };
}

export type ResultadoContagemRevisao = { ok: true; pendentes: number } | { ok: false };

/** Contagem para o indicador do menu. Só administrador: para os demais não devolve nada. */
export async function contarVendasRevisaoAction(): Promise<ResultadoContagemRevisao> {
  const acesso = await verificarAcesso("admin");
  if (!acesso.ok) return { ok: false };
  return { ok: true, pendentes: await contarVendasEmRevisaoPendentes() };
}
