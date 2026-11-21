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
 * Margem ao retomar de um cursor, SOMENTE para diferença de relógio entre o app e o banco (o `updated_at` de um
 * UPDATE é carimbado pelo app; o de um INSERT, pelo banco). NÃO é a proteção contra transações demoradas: essa é o
 * horizonte do servidor (`marca`, abaixo), que não depende de duração nenhuma. Objeto mutável só para os testes
 * poderem encurtar a margem.
 */
export const AJUSTES_SINCRONIZACAO = { sobreposicaoMs: 5 * 60 * 1000 };

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
  /**
   * Só para `estoque`: ids das vendas do aparelho que o servidor ainda pode não ter (pendentes de envio). O servidor
   * responde quais delas já estão gravadas NO MESMO instante em que leu os saldos (`vendas_no_servidor`), para o
   * aparelho descontar só as que o saldo recebido ainda não inclui.
   */
  vendas_locais?: string[];
}

export interface PaginaCatalogo<E extends EntidadeCatalogo = EntidadeCatalogo> {
  /** Instante-limite desta rodada (igual ao enviado, ou o escolhido pelo servidor). */
  ate: string;
  /**
   * Só na primeira página da rodada: o cursor que o aparelho deve gravar ao concluir. É `ate`, recuado até o início da
   * transação mais antiga ainda aberta no banco naquele instante — nenhuma transação aberta pode confirmar depois com
   * data anterior ao cursor, por mais que demore.
   */
  marca?: string;
  /** Só em `estoque` com `vendas_locais`: subconjunto já gravado no servidor no mesmo instante da leitura dos saldos. */
  vendas_no_servidor?: string[];
  itens: ItensPorEntidade[E];
  /** Cursor para a próxima página; null = entidade concluída. */
  proximo: CursorPagina | null;
}
