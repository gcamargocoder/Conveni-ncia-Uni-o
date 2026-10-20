import { isIP } from "node:net";

/**
 * Forma canônica de um IP para usar como CHAVE de limitação de tentativas, de modo que
 * variações de escrita do mesmo cliente não ganhem contadores separados:
 *  - espaços, porta (`1.2.3.4:80`, `[::1]:80`), colchetes e zona (`%eth0`) são removidos;
 *  - IPv4 vira decimal sem zeros à esquerda; IPv4 mapeado em IPv6 (`::ffff:1.2.3.4`) vira IPv4;
 *  - IPv6 é reduzido ao prefixo /64 (a unidade que um cliente controla), em minúsculas e expandido.
 * Valor ilegível ou ausente vira "desconhecido" (um único contador compartilhado — falha fechada).
 */
export function normalizarIp(bruto: string | null | undefined): string {
  if (typeof bruto !== "string") return "desconhecido";
  let v = bruto.trim().toLowerCase();

  const colchetes = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (colchetes) v = colchetes[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  v = v.split("%")[0];

  const mapeado = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (mapeado) v = mapeado[1];

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) {
    const octetos = v.split(".").map((o) => Number(o));
    if (octetos.some((o) => o > 255)) return "desconhecido";
    return octetos.join(".");
  }

  if (v.includes(":") && isIP(v) === 6) return `${expandirIpv6(v).slice(0, 4).join(":")}::/64`;
  return "desconhecido";
}

function expandirIpv6(v: string): string[] {
  // IPv6 com final IPv4 embutido (::1.2.3.4): converte o final em dois grupos hexadecimais
  const ipv4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (ipv4) {
    const [a, b, c, d] = ipv4.slice(1).map(Number);
    v = v.slice(0, ipv4.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [cabeca, cauda] = v.split("::");
  const inicio = cabeca ? cabeca.split(":") : [];
  const fim = cauda !== undefined && cauda ? cauda.split(":") : [];
  const faltam = cauda === undefined ? 0 : 8 - inicio.length - fim.length;
  const grupos = [...inicio, ...Array(Math.max(0, faltam)).fill("0"), ...fim];
  return grupos.map((g) => g.replace(/^0+(?=.)/, ""));
}

/**
 * IP do cliente a partir dos cabeçalhos que o PROXY da hospedagem define. Nunca o primeiro item de
 * x-forwarded-for: o cliente pode enviar esse cabeçalho já preenchido e o proxy apenas ACRESCENTA a
 * origem real ao final. Ordem: x-real-ip (definido pelo proxy) → ÚLTIMO item de x-forwarded-for →
 * "desconhecido" (contador único compartilhado: falha fechada). Premissa a validar na infraestrutura
 * real (AUTENTICACAO.md): o proxy sobrescreve x-real-ip e anexa ao x-forwarded-for.
 */
export function ipDoCliente(ler: (cabecalho: string) => string | null | undefined): string {
  const real = ler("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const ultimo = ler("x-forwarded-for")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .pop();
  return ultimo ? ultimo.slice(0, 64) : "desconhecido";
}
