import { ROTULO_FORMA } from "@/lib/caixa/tipos";
import { ROTULO_SITUACAO, type FiltroVendas } from "./filtro";

export interface RotulosFiltro {
  funcionario: string | null;
  terminal: string | null;
  turno: string | null;
}

/**
 * Filtros EFETIVAMENTE aplicados, em texto, para o cabeçalho da impressão (o período vai à parte).
 * Só lista o que restringe a consulta; sem restrição devolve lista vazia.
 */
export function descreverFiltros(filtro: FiltroVendas, rotulos: RotulosFiltro): string[] {
  const l: string[] = [];
  if (filtro.funcionario_id) l.push(`Funcionário: ${rotulos.funcionario ?? "selecionado"}`);
  if (filtro.terminal_id) l.push(`Terminal: ${rotulos.terminal ?? filtro.terminal_id}`);
  if (filtro.forma) l.push(`Forma de pagamento: ${ROTULO_FORMA[filtro.forma]}`);
  if (filtro.situacao !== "todas") l.push(`Situação: ${ROTULO_SITUACAO[filtro.situacao]}`);
  if (filtro.caixa_id) l.push(`Turno: ${rotulos.turno ?? "selecionado"}`);
  return l;
}
