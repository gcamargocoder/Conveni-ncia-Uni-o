/**
 * Fuso horário da loja — ÚNICA fonte de verdade para exibir e filtrar datas.
 *
 * O banco guarda instantes reais (timestamptz, UTC). Quem decide "que dia/hora é isso" é a loja, não o
 * servidor (UTC no Railway) nem o aparelho de quem olha. Por isso toda formatação e todo limite de dia
 * passam por aqui, com a zona IANA — nunca somando ou subtraindo horas à mão.
 */

export const FUSO_LOJA = "America/Sao_Paulo";

type Entrada = Date | string | number;

const paraDate = (v: Entrada): Date => (v instanceof Date ? v : new Date(v));
const valida = (d: Date) => !Number.isNaN(d.getTime());

/** Formata com segurança: data inválida vira texto vazio em vez de derrubar a tela/exportação. */
const seguro = (fmt: Intl.DateTimeFormat) => (v: Entrada): string => {
  const d = paraDate(v);
  return valida(d) ? fmt.format(d) : "";
};

const fmtData = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_LOJA, day: "2-digit", month: "2-digit", year: "numeric" });
const fmtDataCurta = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_LOJA, day: "2-digit", month: "2-digit" });
const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_LOJA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtHoraSeg = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO_LOJA,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const fmtPartes = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_LOJA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** "18/11/2026" */
export const formatarData = seguro(fmtData);
/** "18/11" */
export const formatarDataCurta = seguro(fmtDataCurta);
/** "21:44" */
export const formatarHora = seguro(fmtHora);
/** "21:44:11" */
export const formatarHoraComSegundos = seguro(fmtHoraSeg);
/** "18/11/2026 21:44" */
export const formatarDataHora = (v: Entrada) => (valida(paraDate(v)) ? `${formatarData(v)} ${formatarHora(v)}` : "");
/** "18/11/2026 21:44:11" */
export const formatarDataHoraComSegundos = (v: Entrada) => (valida(paraDate(v)) ? `${formatarData(v)} ${formatarHoraComSegundos(v)}` : "");
/** "18/11 21:44" */
export const formatarDataHoraCurta = (v: Entrada) => (valida(paraDate(v)) ? `${formatarDataCurta(v)} ${formatarHora(v)}` : "");

interface PartesLocais {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

function partesLocais(v: Entrada): PartesLocais {
  const mapa: Record<string, number> = {};
  for (const p of fmtPartes.formatToParts(paraDate(v))) if (p.type !== "literal") mapa[p.type] = Number(p.value);
  return { ano: mapa.year, mes: mapa.month, dia: mapa.day, hora: mapa.hour, minuto: mapa.minute, segundo: mapa.second };
}

const dois = (n: number) => String(n).padStart(2, "0");

/** Dia da loja ("2026-11-18") a que o instante pertence. É a chave correta para agrupar por dia. */
export function diaLocal(v: Entrada): string {
  const p = partesLocais(v);
  return `${p.ano}-${dois(p.mes)}-${dois(p.dia)}`;
}

/** Hoje, no calendário da loja ("2026-11-18"). */
export const hojeLocal = (agora: Entrada = new Date()) => diaLocal(agora);

/** Soma dias a um dia "YYYY-MM-DD" (aritmética de calendário, sem horário de verão envolvido). */
export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + n));
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`;
}

export const ehDiaValido = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

export const ehHoraValida = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);

/**
 * Converte uma data/hora DE PAREDE da loja ("2026-11-18", "08:00") no instante real (Date).
 * Resolve o deslocamento da zona IANA para aquele momento (sem somar horas fixas): ajusta o palpite
 * em UTC até que a hora local coincida.
 */
export function instanteLocal(dia: string, hora = "00:00:00"): Date {
  if (!ehDiaValido(dia)) throw new RangeError(`Dia inválido: ${dia}`);
  const h = hora.length === 5 ? `${hora}:00` : hora;
  if (!ehHoraValida(h)) throw new RangeError(`Hora inválida: ${hora}`);
  const [a, m, d] = dia.split("-").map(Number);
  const [hh, mm, ss] = h.split(":").map(Number);
  const alvoUtc = Date.UTC(a, m - 1, d, hh, mm, ss);
  let palpite = alvoUtc;
  for (let i = 0; i < 3; i++) {
    const p = partesLocais(palpite);
    const obtidoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
    const erro = alvoUtc - obtidoUtc;
    if (erro === 0) break;
    palpite += erro;
  }
  return new Date(palpite);
}

/** Primeiro instante do dia da loja (inclusivo). */
export const inicioDoDiaLocal = (dia: string) => instanteLocal(dia, "00:00:00");

/** Primeiro instante do dia SEGUINTE (limite exclusivo): use `lt`, nunca `lte 23:59:59`. */
export const fimExclusivoDoDiaLocal = (dia: string) => instanteLocal(somarDias(dia, 1), "00:00:00");

export interface JanelaTempo {
  /** inclusivo */
  inicio: Date;
  /** exclusivo */
  fim: Date;
}

/**
 * Janela [inicio, fim) a partir de dias e horas da loja. Sem hora final, vai até o fim do dia final;
 * sem hora inicial, começa à meia-noite. Hora final informada é INCLUSIVA até o fim daquele minuto
 * (18:00 inclui 18:00:59).
 */
export function janelaLocal(p: { dataInicial: string; dataFinal?: string | null; horaInicial?: string | null; horaFinal?: string | null }): JanelaTempo {
  const dataFinal = p.dataFinal || p.dataInicial;
  const inicio = instanteLocal(p.dataInicial, p.horaInicial || "00:00");
  const fim = p.horaFinal
    ? new Date(instanteLocal(dataFinal, p.horaFinal).getTime() + (p.horaFinal.length === 5 ? 60_000 : 1000))
    : fimExclusivoDoDiaLocal(dataFinal);
  return { inicio, fim };
}

/** Início do mês corrente da loja. */
export function inicioDoMesLocal(agora: Entrada = new Date()): Date {
  const p = partesLocais(agora);
  return instanteLocal(`${p.ano}-${dois(p.mes)}-01`);
}

/** Tolerância para relógio de aparelho adiantado (mesma do caixa). */
export const TOLERANCIA_RELOGIO_MS = 5 * 60_000;

/**
 * Instante informado por um aparelho, saneado: inválido ou mais de 5 min no futuro vira "agora".
 * Nunca soma nem subtrai horas — só descarta o que não é confiável.
 */
export function instanteNaoFuturo(valor: Entrada | null | undefined, agora: Date = new Date()): Date {
  if (valor == null || valor === "") return agora;
  const d = paraDate(valor);
  if (!valida(d) || d.getTime() > agora.getTime() + TOLERANCIA_RELOGIO_MS) return agora;
  return d;
}
