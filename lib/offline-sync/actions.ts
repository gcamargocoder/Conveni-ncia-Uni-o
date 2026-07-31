"use server";

import { listarProdutosAlteradosDesde } from "@/services/produtos.service";
import { listarCategoriasAlteradasDesde } from "@/services/categorias.service";
import { listarEstoqueAlteradoDesde } from "@/services/estoque.service";

export interface AlteracoesCatalogo {
  produtos: Awaited<ReturnType<typeof listarProdutosAlteradosDesde>>;
  categorias: Awaited<ReturnType<typeof listarCategoriasAlteradasDesde>>;
  estoque: Awaited<ReturnType<typeof listarEstoqueAlteradoDesde>>;
  /**
   * Capturado ANTES de rodar as três buscas — se usássemos o horário de
   * depois, uma alteração feita durante a própria consulta poderia ficar
   * fora da janela e nunca ser sincronizada. Usar o horário de antes
   * significa, na pior das hipóteses, buscar o mesmo registro duas
   * vezes (inofensivo — upsert por PK), nunca perder um.
   */
  timestampServidor: string;
}

export async function buscarAlteracoesCatalogoAction(
  desdeIso: string | null
): Promise<AlteracoesCatalogo> {
  const inicio = new Date();
  const desde = desdeIso ? new Date(desdeIso) : null;

  const [produtos, categorias, estoque] = await Promise.all([
    listarProdutosAlteradosDesde(desde),
    listarCategoriasAlteradasDesde(desde),
    listarEstoqueAlteradoDesde(desde),
  ]);

  return { produtos, categorias, estoque, timestampServidor: inicio.toISOString() };
}
