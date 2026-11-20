import { FORMAS_CAIXA, type FormaCaixa } from "@/lib/caixa/tipos";
import { ehDiaValido, ehHoraValida, hojeLocal, janelaLocal, somarDias, type JanelaTempo } from "@/lib/utils/fuso";

/**
 * Filtros do relatório de vendas. A MESMA leitura serve a tela e a exportação Excel: a planilha respeita
 * exatamente o que a tela mostra porque os dois recebem os mesmos parâmetros de URL e passam por aqui.
 */

export type SituacaoVenda = "todas" | "ativas" | "canceladas";
export const SITUACOES: readonly SituacaoVenda[] = ["todas", "ativas", "canceladas"];
export const ROTULO_SITUACAO: Record<SituacaoVenda, string> = { todas: "Todas", ativas: "Válidas", canceladas: "Canceladas" };

export interface FiltroVendas {
  /** Dias e horas são do relógio da LOJA (America/Sao_Paulo). */
  dataInicial: string;
  dataFinal: string;
  horaInicial: string | null;
  horaFinal: string | null;
  funcionario_id: string | null;
  terminal_id: string | null;
  /** Turno = um caixa (abertura → fechamento). */
  caixa_id: string | null;
  forma: FormaCaixa | null;
  situacao: SituacaoVenda;
}

export type ParametrosBrutos = Record<string, string | string[] | undefined>;

export const PRESETS_PERIODO: Record<string, number> = { hoje: 0, "7dias": 7, "30dias": 30 };
export const ROTULOS_PRESET: Record<string, string> = { hoje: "Hoje", "7dias": "7 dias", "30dias": "30 dias" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O terminal é um texto livre gerado pelo aparelho (o servidor aceita qualquer texto até 80 caracteres). */
const TERMINAL = /^[A-Za-z0-9_.:@-]{1,80}$/;

const um = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? "" : v ?? "").trim();

export interface FiltroLido {
  filtro: FiltroVendas;
  /** Preset usado quando não há intervalo explícito ("hoje", "7dias", "30dias"). */
  preset: string | null;
  /** Mensagens de parâmetros descartados por inválidos (a consulta segue com o que era válido). */
  avisos: string[];
}

function terminalValido(valor: string, avisos: string[]): string | null {
  if (!valor) return null;
  if (TERMINAL.test(valor)) return valor;
  avisos.push("Terminal inválido: ignorado.");
  return null;
}

export function lerFiltroVendas(params: ParametrosBrutos, agora: Date = new Date()): FiltroLido {
  const avisos: string[] = [];
  const hoje = hojeLocal(agora);

  const de = um(params.de);
  const ate = um(params.ate);
  const hi = um(params.hi);
  const hf = um(params.hf);

  let preset: string | null = null;
  let dataInicial: string;
  let dataFinal: string;

  if (de) {
    if (ehDiaValido(de)) dataInicial = de;
    else {
      avisos.push("Data inicial inválida: usando hoje.");
      dataInicial = hoje;
    }
    dataFinal = ate && ehDiaValido(ate) ? ate : dataInicial;
    if (ate && !ehDiaValido(ate)) avisos.push("Data final inválida: usando a data inicial.");
    if (dataFinal < dataInicial) {
      avisos.push("A data final era anterior à inicial: período invertido.");
      [dataInicial, dataFinal] = [dataFinal, dataInicial];
    }
  } else {
    const pedido = um(params.periodo);
    preset = pedido in PRESETS_PERIODO ? pedido : "7dias";
    dataFinal = hoje;
    dataInicial = somarDias(hoje, -PRESETS_PERIODO[preset]);
  }

  let horaInicial: string | null = null;
  let horaFinal: string | null = null;
  if (hi) {
    if (ehHoraValida(hi)) horaInicial = hi.slice(0, 5);
    else avisos.push("Horário inicial inválido: ignorado.");
  }
  if (hf) {
    if (ehHoraValida(hf)) horaFinal = hf.slice(0, 5);
    else avisos.push("Horário final inválido: ignorado.");
  }
  if (dataInicial === dataFinal && horaInicial && horaFinal && horaFinal < horaInicial) {
    avisos.push("O horário final era anterior ao inicial no mesmo dia: horários ignorados.");
    horaInicial = null;
    horaFinal = null;
  }

  const id = (valor: string, nome: string) => {
    if (!valor) return null;
    if (UUID.test(valor)) return valor.toLowerCase();
    avisos.push(`${nome} inválido: ignorado.`);
    return null;
  };

  const formaBruta = um(params.forma);
  const forma = (FORMAS_CAIXA as readonly string[]).includes(formaBruta) ? (formaBruta as FormaCaixa) : null;
  if (formaBruta && !forma) avisos.push("Forma de pagamento inválida: ignorada.");

  const situacaoBruta = um(params.situacao);
  const situacao = (SITUACOES as readonly string[]).includes(situacaoBruta) ? (situacaoBruta as SituacaoVenda) : "todas";

  return {
    filtro: {
      dataInicial,
      dataFinal,
      horaInicial,
      horaFinal,
      funcionario_id: id(um(params.funcionario), "Funcionário"),
      terminal_id: terminalValido(um(params.terminal), avisos),
      caixa_id: id(um(params.caixa), "Turno"),
      forma,
      situacao,
    },
    preset,
    avisos,
  };
}

export function janelaDoFiltro(f: FiltroVendas): JanelaTempo {
  return janelaLocal({ dataInicial: f.dataInicial, dataFinal: f.dataFinal, horaInicial: f.horaInicial, horaFinal: f.horaFinal });
}

/** Parâmetros canônicos de URL do filtro (usados no link da exportação, para que ela repita a tela). */
export function paraQueryString(f: FiltroVendas): string {
  const q = new URLSearchParams();
  q.set("de", f.dataInicial);
  q.set("ate", f.dataFinal);
  if (f.horaInicial) q.set("hi", f.horaInicial);
  if (f.horaFinal) q.set("hf", f.horaFinal);
  if (f.funcionario_id) q.set("funcionario", f.funcionario_id);
  if (f.terminal_id) q.set("terminal", f.terminal_id);
  if (f.caixa_id) q.set("caixa", f.caixa_id);
  if (f.forma) q.set("forma", f.forma);
  if (f.situacao !== "todas") q.set("situacao", f.situacao);
  return q.toString();
}
