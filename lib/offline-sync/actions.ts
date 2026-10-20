"use server";

import { verificarAcesso } from "@/lib/auth/servidor";
import { listarProdutosAlteradosDesde } from "@/services/produtos.service";
import { listarCategoriasAlteradasDesde } from "@/services/categorias.service";
import { listarEstoqueAlteradoDesde } from "@/services/estoque.service";
import { listarFuncionariosCatalogoDesde, listarCredenciaisPinOffline, type CredencialPinOffline } from "@/services/funcionarios.service";
import { listarClientesAlteradosDesde } from "@/services/clientes.service";

export interface AlteracoesCatalogo {
  produtos: Awaited<ReturnType<typeof listarProdutosAlteradosDesde>>;
  categorias: Awaited<ReturnType<typeof listarCategoriasAlteradasDesde>>;
  estoque: Awaited<ReturnType<typeof listarEstoqueAlteradoDesde>>;
  funcionarios: Awaited<ReturnType<typeof listarFuncionariosCatalogoDesde>>;
  clientes: Awaited<ReturnType<typeof listarClientesAlteradosDesde>>;
  timestampServidor: string;
}

export async function buscarAlteracoesCatalogoAction(
  desdeIso: string | null
): Promise<AlteracoesCatalogo> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) throw new Error(acesso.erro);
  const inicio = new Date();
  const desde = desdeIso ? new Date(desdeIso) : null;

  const [produtos, categorias, estoque, funcionarios, clientes] = await Promise.all([
    listarProdutosAlteradosDesde(desde),
    listarCategoriasAlteradasDesde(desde),
    listarEstoqueAlteradoDesde(desde),
    listarFuncionariosCatalogoDesde(desde),
    listarClientesAlteradosDesde(desde),
  ]);

  return { produtos, categorias, estoque, funcionarios, clientes, timestampServidor: inicio.toISOString() };
}

export type ResultadoCredenciaisPinOffline =
  | { ok: true; credenciais: CredencialPinOffline[] }
  | { ok: false; erro: string };

/**
 * Verificadores de PIN para o PDV offline. Canal PRÓPRIO (separado do catálogo): só devolve
 * funcionários ativos de cargos que apenas vendem — o PIN de quem pode mais que isso nunca
 * sai do servidor. O aparelho substitui TODA a lista a cada resposta, então quem foi
 * desativado/removido/promovido some do aparelho na próxima sincronização.
 */
export async function buscarCredenciaisPinOfflineAction(): Promise<ResultadoCredenciaisPinOffline> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { ok: false, erro: acesso.erro };
  return { ok: true, credenciais: await listarCredenciaisPinOffline() };
}
