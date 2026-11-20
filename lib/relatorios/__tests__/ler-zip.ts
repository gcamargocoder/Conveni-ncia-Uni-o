import { inflateRawSync } from "node:zlib";
import { expect } from "vitest";
import { crc32 } from "../xlsx";

/** Leitor mínimo de ZIP/XLSX para testes: valida assinatura, diretório central, CRC e tamanhos. */
export function lerZip(buf: Buffer): Map<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThan(0);
  const total = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const arquivos = new Map<string, Buffer>();
  for (let i = 0; i < total; i++) {
    expect(buf.readUInt32LE(pos)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(pos + 16);
    const tamC = buf.readUInt32LE(pos + 20);
    const tam = buf.readUInt32LE(pos + 24);
    const tamNome = buf.readUInt16LE(pos + 28);
    const desloc = buf.readUInt32LE(pos + 42);
    const nome = buf.subarray(pos + 46, pos + 46 + tamNome).toString("utf8");
    expect(buf.readUInt32LE(desloc)).toBe(0x04034b50);
    const dadosIni = desloc + 30 + buf.readUInt16LE(desloc + 26) + buf.readUInt16LE(desloc + 28);
    const dados = inflateRawSync(buf.subarray(dadosIni, dadosIni + tamC));
    expect(dados.length).toBe(tam);
    expect(crc32(dados)).toBe(crc);
    arquivos.set(nome, dados);
    pos += 46 + tamNome;
  }
  return arquivos;
}

export interface CelulaLida {
  ref: string;
  texto?: string;
  numero?: number;
}

/** Lê as células de uma aba (texto inline ou número) — o suficiente para conferir totais. */
export function lerAba(xml: string): Map<string, CelulaLida> {
  const celulas = new Map<string, CelulaLida>();
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, ref, corpo = ""] = m;
    const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(corpo);
    const v = /<v>([\s\S]*?)<\/v>/.exec(corpo);
    if (t) {
      celulas.set(ref, { ref, texto: t[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&") });
    } else if (v) celulas.set(ref, { ref, numero: Number(v[1]) });
  }
  return celulas;
}
