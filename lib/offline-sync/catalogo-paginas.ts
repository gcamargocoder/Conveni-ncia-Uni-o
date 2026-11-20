import type { Produto } from "@/types/produto";
import type { Cliente } from "@/types/cliente";
import type { Categoria } from "@/services/categorias.service";
import type { FuncionarioCatalogo } from "@/services/funcionarios.service";
import type { EstoqueAtual } from "@/services/estoque.service";

/**
 * Contrato da sincronização PAGINADA do catálogo offline (compartilhado entre servidor e aparelho; só tipos e
 * constantes, nenhum código de servidor).
 *
 * Por que paginar: a leitura antiga trazia no máximo 500 produtos/clientes (1.000 de estoque) numa só chamada e o
 * aparelho gravava o cursor de sincronização mesmo assim — o que passasse do limite nunca chegava ao PDV offline.
 * Agora cada entidade é lida em páginas por cursor composto (data de atualização + id), contra um instante-limite
 * fixo (`ate`) escolhido pelo servidor no início da rodada, e o cursor global só avança quando TODAS as páginas
 * de TODAS as entidades foram gravadas.
 */
export type EntidadeCatalogo = "categorias" | "produtos" | "clientes" | "funcionarios" | "estoque";

/** Ordem de leitura: quem é referenciado vem antes (categorias → produtos → estoque). */
export const ENTIDADES_CATALOGO: readonly EntidadeCatalogo[] = ["categorias", "produtos", "estoque", "clientes", "funcionarios"];

/**
 * Posição de leitura. `t` é o `updated_at` com precisão de microssegundos, como TEXTO ISO: o `Date` do JavaScript
 * só tem milissegundos, e linhas inseridas em lote compartilham o mesmo `now()` de microssegundos — comparar por
 * `Date` repetiria a mesma página para sempre. Estoque não tem data: usa só `id` (t = null).
 */
export interface CursorPagina {
  t: string | null;
  id: string;
}

/** Linhas por página. Uma página de produtos serializa em ~0,2 MB. */
export const TAMANHO_PAGINA_CATALOGO = 500;
export const TAMANHO_MAXIMO_PAGINA_CATALOGO = 1000;

/**
 * Margem de segurança ao retomar de um cursor: uma transação que começou antes do instante-limite e só gravou depois
 * tem `updated_at`/`created_at` ANTERIOR ao cursor mas ainda não era visível na rodada anterior. Reler os últimos
 * minutos é barato e inofensivo (as gravações locais são idempotentes: chave primária + bulkPut).
 */
export const SOBREPOSICAO_MS = 5 * 60 * 1000;

export interface ItensPorEntidade {
  categorias: Categoria[];
  produtos: Produto[];
  clientes: Cliente[];
  funcionarios: FuncionarioCatalogo[];
  estoque: EstoqueAtual[];
}

export interface EntradaPaginaCatalogo<E extends EntidadeCatalogo = EntidadeCatalogo> {
  entidade: E;
  /** Início da janela (inclusive); null = primeira sincronização (tudo). */
  desde: string | null;
  /** Instante-limite da rodada; null na primeira página (o servidor escolhe e devolve). */
  ate: string | null;
  /** Último item já recebido; null = começar do início. */
  apos: CursorPagina | null;
  tamanho?: number;
}

export interface PaginaCatalogo<E extends EntidadeCatalogo = EntidadeCatalogo> {
  /** Instante-limite desta rodada (igual ao enviado, ou o escolhido pelo servidor). */
  ate: string;
  itens: ItensPorEntidade[E];
  /** Cursor para a próxima página; null = entidade concluída. */
  proximo: CursorPagina | null;
}
