import { Prisma } from "@prisma/client";
import { prisma } from "./prisma/client";
import { executar } from "./prisma/query-helpers";
import type { Produto } from "@/types/produto";
import type { Cliente } from "@/types/cliente";
import {
  TAMANHO_PAGINA_CATALOGO,
  TAMANHO_MAXIMO_PAGINA_CATALOGO,
  type CursorPagina,
  type EntidadeCatalogo,
  type ItensPorEntidade,
} from "@/lib/offline-sync/catalogo-paginas";

/**
 * Leitura PAGINADA do catálogo para o PDV offline (somente leitura; nada aqui grava).
 *
 * Ordem total estável: (updated_at, id). Linhas com o MESMO updated_at (inserções em lote) são desempatadas pelo id
 * e nenhuma é pulada nem repetida entre páginas. A janela é [desde, ate]: `ate` é fixado no início da rodada, então
 * o que muda DURANTE a paginação (updated_at > ate) fica de fora desta rodada e entra na próxima (que começa em
 * `ate`, menos a sobreposição). Assim não há lacuna entre páginas nem entre rodadas.
 */

const FORMATO_ISO_US = Prisma.sql`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

type TabelaComData = "produtos" | "clientes" | "categorias" | "funcionarios";
const TABELA: Record<TabelaComData, Prisma.Sql> = {
  produtos: Prisma.sql`produtos`,
  clientes: Prisma.sql`clientes`,
  categorias: Prisma.sql`categorias`,
  funcionarios: Prisma.sql`funcionarios`,
};

type ClienteSql = Pick<typeof prisma, "$queryRaw">;

export interface JanelaCatalogo {
  desde: string | null;
  ate: string;
  apos: CursorPagina | null;
}

/**
 * Instantes da rodada, do relógio do BANCO (`updated_at`/`created_at` são carimbados pelo banco/Prisma e os relógios
 * podem diferir; `clock_timestamp()`, e não `now()`, dá o instante real da consulta).
 *
 * - `ate`: limite superior da janela desta rodada (agora).
 * - `marca`: o cursor que o aparelho grava ao concluir = `ate` recuado até o INÍCIO da transação mais antiga ainda
 *   aberta no banco agora. Por quê: o `created_at` de um INSERT é o `now()` do começo da transação, e o `updated_at`
 *   de um UPDATE é carimbado no meio dela. Uma transação aberta há 20 minutos confirma com data de 20 minutos atrás;
 *   com cursor só por tempo (mesmo com margem) a linha sumiria para sempre. Com o horizonte, nenhuma transação que
 *   estava aberta aqui consegue confirmar depois com data anterior à marca — por mais que demore. Se a transação
 *   nunca fechar, a marca fica parada e a janela só cresce (mais releitura idempotente), nunca perde.
 *   O banco só mostra `xact_start` de outras conexões do MESMO papel (o do app, único que escreve).
 */
export async function instantesDaRodada(): Promise<{ ate: string; marca: string }> {
  const r = await prisma.$queryRaw<{ ate: string; marca: string }[]>`
    SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', ${FORMATO_ISO_US}) AS ate,
           to_char(LEAST(clock_timestamp(), COALESCE(MIN(xact_start), clock_timestamp())) AT TIME ZONE 'UTC', ${FORMATO_ISO_US}) AS marca
    FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend' AND xact_start IS NOT NULL`;
  return r[0];
}

/** @deprecated use instantesDaRodada (que também devolve a marca do cursor). */
export async function instanteAtualDoBanco(): Promise<string> {
  return (await instantesDaRodada()).ate;
}

function limitar(tamanho: number | undefined): number {
  const n = Math.floor(tamanho ?? TAMANHO_PAGINA_CATALOGO);
  if (!Number.isFinite(n) || n < 1) return TAMANHO_PAGINA_CATALOGO;
  return Math.min(n, TAMANHO_MAXIMO_PAGINA_CATALOGO);
}

/** Chaves (id + updated_at em µs) da página, uma a mais que o tamanho para saber se há próxima. */
async function chavesComData(tabela: TabelaComData, j: JanelaCatalogo, tamanho: number): Promise<{ id: string; t: string }[]> {
  const aposT = j.apos?.t ?? null;
  const aposId = j.apos?.id ?? null;
  return prisma.$queryRaw<{ id: string; t: string }[]>`
    SELECT id::text AS id, to_char(updated_at AT TIME ZONE 'UTC', ${FORMATO_ISO_US}) AS t
    FROM ${TABELA[tabela]}
    WHERE (${j.desde}::timestamptz IS NULL OR updated_at >= ${j.desde}::timestamptz)
      AND updated_at <= ${j.ate}::timestamptz
      AND (${aposT}::timestamptz IS NULL OR (updated_at, id) > (${aposT}::timestamptz, ${aposId}::uuid))
    ORDER BY updated_at, id
    LIMIT ${tamanho + 1}`;
}

/** Ids de estoque a enviar: tudo (primeira vez) ou só produtos com movimentação/alteração na janela. */
async function chavesEstoque(db: ClienteSql, j: JanelaCatalogo, tamanho: number): Promise<{ id: string }[]> {
  const aposId = j.apos?.id ?? null;
  if (!j.desde) {
    return db.$queryRaw<{ id: string }[]>`
      SELECT produto_id::text AS id FROM estoque_atual
      WHERE (${aposId}::uuid IS NULL OR produto_id > ${aposId}::uuid)
      ORDER BY produto_id
      LIMIT ${tamanho + 1}`;
  }
  return db.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM (
      SELECT produto_id AS id FROM movimentacoes_estoque
       WHERE created_at >= ${j.desde}::timestamptz AND created_at <= ${j.ate}::timestamptz
      UNION
      SELECT id FROM produtos
       WHERE updated_at >= ${j.desde}::timestamptz AND updated_at <= ${j.ate}::timestamptz AND deleted_at IS NULL
    ) alterados
    WHERE (${aposId}::uuid IS NULL OR id > ${aposId}::uuid)
    ORDER BY id
    LIMIT ${tamanho + 1}`;
}

function recortar<K extends { id: string; t?: string }>(chaves: K[], tamanho: number) {
  const haMais = chaves.length > tamanho;
  const pagina = haMais ? chaves.slice(0, tamanho) : chaves;
  const ultimo = pagina[pagina.length - 1];
  const proximo: CursorPagina | null = haMais && ultimo ? { t: ultimo.t ?? null, id: ultimo.id } : null;
  return { pagina, proximo };
}

function naOrdem<T extends { id: string }>(linhas: T[], ids: string[]): T[] {
  const porId = new Map(linhas.map((l) => [l.id, l]));
  return ids.flatMap((id) => {
    const l = porId.get(id);
    return l ? [l] : [];
  });
}

export async function lerPaginaCatalogo<E extends EntidadeCatalogo>(
  entidade: E,
  janela: JanelaCatalogo,
  tamanhoPedido?: number,
  vendasLocais?: string[]
): Promise<{ itens: ItensPorEntidade[E]; proximo: CursorPagina | null; vendas_no_servidor?: string[] }> {
  const tamanho = limitar(tamanhoPedido);
  return executar<{ itens: ItensPorEntidade[E]; proximo: CursorPagina | null; vendas_no_servidor?: string[] }>(async () => {
    if (entidade === "estoque") {
      // Uma transação REPEATABLE READ: os saldos e a checagem das vendas veem o MESMO instante do banco.
      return prisma.$transaction(
        async (tx) => {
          const { pagina, proximo } = recortar(await chavesEstoque(tx, janela, tamanho), tamanho);
          const ids = pagina.map((c) => c.id);
          const itens = ids.length
            ? await tx.$queryRaw<ItensPorEntidade["estoque"]>`
                SELECT produto_id, nome, codigo_barras, categoria_nome, fornecedor_nome, estoque_minimo, quantidade_atual
                FROM estoque_atual WHERE produto_id = ANY(${ids}::uuid[]) ORDER BY produto_id`
            : [];
          const vendas = vendasLocais?.length
            ? (await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM vendas WHERE id = ANY(${vendasLocais}::uuid[])`).map((v) => v.id)
            : undefined;
          return { itens: itens as ItensPorEntidade[E], proximo, vendas_no_servidor: vendas };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      );
    }

    const tabela = entidade as TabelaComData;
    const { pagina, proximo } = recortar(await chavesComData(tabela, janela, tamanho), tamanho);
    const ids = pagina.map((c) => c.id);
    let linhas: { id: string }[] = [];
    if (ids.length) {
      if (tabela === "produtos") linhas = (await prisma.produto.findMany({ where: { id: { in: ids } } })) as unknown as Produto[];
      else if (tabela === "clientes") linhas = (await prisma.cliente.findMany({ where: { id: { in: ids } } })) as unknown as Cliente[];
      else if (tabela === "categorias")
        linhas = await prisma.categoria.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true, ativo: true, updated_at: true } });
      else
        linhas = await prisma.funcionario.findMany({
          where: { id: { in: ids } },
          // select explícito: um campo novo na tabela nunca vaza por acidente (nunca o pin_hash).
          select: { id: true, nome: true, cargo: true, ativo: true, created_at: true, updated_at: true, deleted_at: true },
        });
    }
    return { itens: naOrdem(linhas, ids) as unknown as ItensPorEntidade[E], proximo };
  }, "Erro ao sincronizar o catálogo");
}
