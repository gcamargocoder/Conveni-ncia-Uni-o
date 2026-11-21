"use server";

import { verificarAcesso } from "@/lib/auth/servidor";
import { listarProdutosAlteradosDesde } from "@/services/produtos.service";
import { listarCategoriasAlteradasDesde } from "@/services/categorias.service";
import { listarEstoqueAlteradoDesde } from "@/services/estoque.service";
import { listarFuncionariosCatalogoDesde, listarCredenciaisPinOffline, type CredencialPinOffline } from "@/services/funcionarios.service";
import { listarClientesAlteradosDesde } from "@/services/clientes.service";
import { instantesDaRodada, lerPaginaCatalogo } from "@/services/catalogo-sync.service";
import type { EntradaPaginaCatalogo, PaginaCatalogo } from "./catalogo-paginas";
import { validarEntradaPagina } from "./validar-pagina";

export interface AlteracoesCatalogo {
  produtos: Awaited<ReturnType<typeof listarProdutosAlteradosDesde>>;
  categorias: Awaited<ReturnType<typeof listarCategoriasAlteradasDesde>>;
  estoque: Awaited<ReturnType<typeof listarEstoqueAlteradoDesde>>;
  funcionarios: Awaited<ReturnType<typeof listarFuncionariosCatalogoDesde>>;
  clientes: Awaited<ReturnType<typeof listarClientesAlteradosDesde>>;
  timestampServidor: string;
}

/**
 * @deprecated Lê no máximo 500/1.000 registros por chamada (sem paginação). O aparelho usa
 * `buscarPaginaCatalogoAction`; esta permanece só para abas antigas que ainda chamam a versão anterior (elas
 * recarregam ao detectar a nova versão). Não a use em código novo.
 */
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

/**
 * Uma página de UMA entidade do catálogo (ver catalogo-paginas.ts). Somente leitura. Na primeira página da rodada
 * `ate` vem nulo e o servidor escolhe o instante-limite (relógio do servidor, não do aparelho); as demais páginas
 * devolvem o mesmo `ate` para a janela não se mover enquanto pagina.
 */
export async function buscarPaginaCatalogoAction(entrada: EntradaPaginaCatalogo): Promise<PaginaCatalogo> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) throw new Error(acesso.erro);
  const v = validarEntradaPagina(entrada);
  // Primeira página da rodada: o servidor fixa a janela (`ate`) e a marca do cursor (`marca`).
  const instantes = v.ate ? null : await instantesDaRodada();
  const ate = v.ate ?? (instantes as { ate: string }).ate;
  const { itens, proximo, vendas_no_servidor } = await lerPaginaCatalogo(
    v.entidade,
    { desde: v.desde, ate, apos: v.apos },
    v.tamanho,
    v.vendas_locais
  );
  return { ate, marca: instantes?.marca, itens, proximo, vendas_no_servidor } as PaginaCatalogo;
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
