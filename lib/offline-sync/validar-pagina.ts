import {
  ENTIDADES_CATALOGO,
  TAMANHO_MAXIMO_PAGINA_CATALOGO,
  type CursorPagina,
  type EntidadeCatalogo,
  type EntradaPaginaCatalogo,
} from "./catalogo-paginas";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_MICROS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

function dataIso(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || !ISO_MICROS.test(valor) || Number.isNaN(Date.parse(valor))) {
    throw new Error(`Parâmetro inválido: ${campo}.`);
  }
  return valor;
}

/**
 * A entrada vem do navegador: nada é confiado. Datas só em ISO UTC (vão ao SQL como parâmetro tipado, nunca
 * concatenadas), ids só UUID, entidade só da lista, tamanho limitado.
 */
export function validarEntradaPagina(entrada: unknown): EntradaPaginaCatalogo & { ate: string | null } {
  if (!entrada || typeof entrada !== "object") throw new Error("Parâmetros inválidos.");
  const e = entrada as Record<string, unknown>;

  if (typeof e.entidade !== "string" || !(ENTIDADES_CATALOGO as readonly string[]).includes(e.entidade)) {
    throw new Error("Parâmetro inválido: entidade.");
  }
  const desde = e.desde == null ? null : dataIso(e.desde, "desde");
  const ate = e.ate == null ? null : dataIso(e.ate, "ate");
  if (desde && ate && Date.parse(desde) > Date.parse(ate)) throw new Error("Parâmetro inválido: janela.");

  let apos: CursorPagina | null = null;
  if (e.apos != null) {
    const a = e.apos as Record<string, unknown>;
    if (typeof a !== "object" || typeof a.id !== "string" || !UUID.test(a.id)) throw new Error("Parâmetro inválido: apos.");
    const t = a.t == null ? null : dataIso(a.t, "apos.t");
    if (t === null && e.entidade !== "estoque") throw new Error("Parâmetro inválido: apos.");
    apos = { t, id: a.id };
  }

  let tamanho: number | undefined;
  if (e.tamanho != null) {
    if (typeof e.tamanho !== "number" || !Number.isInteger(e.tamanho) || e.tamanho < 1 || e.tamanho > TAMANHO_MAXIMO_PAGINA_CATALOGO) {
      throw new Error("Parâmetro inválido: tamanho.");
    }
    tamanho = e.tamanho;
  }

  return { entidade: e.entidade as EntidadeCatalogo, desde, ate, apos, tamanho };
}
