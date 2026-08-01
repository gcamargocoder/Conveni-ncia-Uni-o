"use server";

import { listarProdutosAlteradosDesde } from "@/services/produtos.service";
import { listarCategoriasAlteradasDesde } from "@/services/categorias.service";
import { listarEstoqueAlteradoDesde } from "@/services/estoque.service";
import { listarFuncionariosAlteradosDesde } from "@/services/funcionarios.service";

export interface AlteracoesCatalogo {
  produtos: Awaited<ReturnType<typeof listarProdutosAlteradosDesde>>;
  categorias: Awaited<ReturnType<typeof listarCategoriasAlteradasDesde>>;
  estoque: Awaited<ReturnType<typeof listarEstoqueAlteradoDesde>>;
  funcionarios: Awaited<ReturnType<typeof listarFuncionariosAlteradosDesde>>;
  timestampServidor: string;
}

export async function buscarAlteracoesCatalogoAction(
  desdeIso: string | null
): Promise<AlteracoesCatalogo> {
  const inicio = new Date();
  const desde = desdeIso ? new Date(desdeIso) : null;

  const [produtos, categorias, estoque, funcionarios] = await Promise.all([
    listarProdutosAlteradosDesde(desde),
    listarCategoriasAlteradasDesde(desde),
    listarEstoqueAlteradoDesde(desde),
    listarFuncionariosAlteradosDesde(desde),
  ]);

  return { produtos, categorias, estoque, funcionarios, timestampServidor: inicio.toISOString() };
}