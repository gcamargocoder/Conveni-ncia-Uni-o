"use server";

import { listarProdutosAlteradosDesde } from "@/services/produtos.service";
import { listarCategoriasAlteradasDesde } from "@/services/categorias.service";
import { listarEstoqueAlteradoDesde } from "@/services/estoque.service";
import { listarFuncionariosAlteradosDesde } from "@/services/funcionarios.service";
import { listarClientesAlteradosDesde } from "@/services/clientes.service";

export interface AlteracoesCatalogo {
  produtos: Awaited<ReturnType<typeof listarProdutosAlteradosDesde>>;
  categorias: Awaited<ReturnType<typeof listarCategoriasAlteradasDesde>>;
  estoque: Awaited<ReturnType<typeof listarEstoqueAlteradoDesde>>;
  funcionarios: Awaited<ReturnType<typeof listarFuncionariosAlteradosDesde>>;
  clientes: Awaited<ReturnType<typeof listarClientesAlteradosDesde>>;
  timestampServidor: string;
}

export async function buscarAlteracoesCatalogoAction(
  desdeIso: string | null
): Promise<AlteracoesCatalogo> {
  const inicio = new Date();
  const desde = desdeIso ? new Date(desdeIso) : null;

  const [produtos, categorias, estoque, funcionarios, clientes] = await Promise.all([
    listarProdutosAlteradosDesde(desde),
    listarCategoriasAlteradasDesde(desde),
    listarEstoqueAlteradoDesde(desde),
    listarFuncionariosAlteradosDesde(desde),
    listarClientesAlteradosDesde(desde),
  ]);

  return { produtos, categorias, estoque, funcionarios, clientes, timestampServidor: inicio.toISOString() };
}