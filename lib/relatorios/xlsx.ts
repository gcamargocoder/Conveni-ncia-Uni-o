import { deflateRawSync } from "node:zlib";

/**
 * Gerador mínimo de .xlsx (Office Open XML) sem dependências. SOMENTE servidor (usa node:zlib).
 *
 *  - Textos vão como `inlineStr`: o Excel nunca os interpreta como fórmula (sem injeção por "=…", "+…", "@…").
 *  - Dinheiro vai como NÚMERO com formato de moeda (somável na planilha), em reais com 2 casas, vindo de centavos
 *    inteiros — sem ponto flutuante acumulado.
 *  - Datas e horas vão como TEXTO já no relógio da loja: o Excel não aplica fuso nenhum e o que se vê é o que a
 *    tela mostrou.
 */

export type Celula = string | number | null | undefined | { centavos: number } | { qtd: number } | { inteiro: number };

export interface Planilha {
  /** Máx. 31 caracteres, sem []:*?/\ */
  nome: string;
  colunas: { titulo: string; largura?: number }[];
  linhas: Celula[][];
}

const ESTILO = { padrao: 0, cabecalho: 1, moeda: 2, quantidade: 3, inteiro: 4 } as const;

const escapar = (s: string) =>
  s
    // caracteres de controle proibidos em XML 1.0 (exceto \t \n \r)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function nomeColuna(indice: number): string {
  let n = indice;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function nomeSeguro(nome: string): string {
  return nome.replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Planilha";
}

function celulaXml(ref: string, c: Celula, estiloTexto: number): string {
  if (c === null || c === undefined || c === "") return "";
  if (typeof c === "string") return `<c r="${ref}" s="${estiloTexto}" t="inlineStr"><is><t xml:space="preserve">${escapar(c)}</t></is></c>`;
  if (typeof c === "number") return `<c r="${ref}"><v>${Number.isFinite(c) ? c : 0}</v></c>`;
  if ("centavos" in c) return `<c r="${ref}" s="${ESTILO.moeda}"><v>${(Math.round(c.centavos) / 100).toFixed(2)}</v></c>`;
  if ("qtd" in c) return `<c r="${ref}" s="${ESTILO.quantidade}"><v>${c.qtd}</v></c>`;
  return `<c r="${ref}" s="${ESTILO.inteiro}"><v>${Math.round(c.inteiro)}</v></c>`;
}

function planilhaXml(p: Planilha): string {
  const cols = p.colunas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura ?? 16}" customWidth="1"/>`).join("");
  const cab = `<row r="1">${p.colunas.map((c, i) => celulaXml(`${nomeColuna(i)}1`, c.titulo, ESTILO.cabecalho)).join("")}</row>`;
  const corpo = p.linhas
    .map((linha, r) => `<row r="${r + 2}">${linha.map((c, i) => celulaXml(`${nomeColuna(i)}${r + 2}`, c, ESTILO.padrao)).join("")}</row>`)
    .join("");
  const ultima = `${nomeColuna(Math.max(p.colunas.length - 1, 0))}${p.linhas.length + 1}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${ultima}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${cab}${corpo}</sheetData>` +
    `<autoFilter ref="A1:${ultima}"/></worksheet>`
  );
}

const ESTILOS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.000"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="5">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// --- ZIP (método "deflate"), CRC-32 -----------------------------------------------------------------------------

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface Arquivo {
  nome: string;
  dados: Buffer;
}

function zip(arquivos: Arquivo[]): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let deslocamento = 0;
  // 2026-01-01 00:00 no formato DOS (evita datas aleatórias; o conteúdo é o que importa)
  const dosHora = 0;
  const dosData = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, "utf8");
    const comprimido = deflateRawSync(a.dados);
    const crc = crc32(a.dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosHora, 10);
    local.writeUInt16LE(dosData, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(a.dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nome, comprimido);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(dosHora, 12);
    cd.writeUInt16LE(dosData, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comprimido.length, 20);
    cd.writeUInt32LE(a.dados.length, 24);
    cd.writeUInt16LE(nome.length, 28);
    cd.writeUInt32LE(deslocamento, 42);
    central.push(cd, nome);

    deslocamento += local.length + nome.length + comprimido.length;
  }

  const tamCentral = central.reduce((s, b) => s + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamCentral, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...partes, ...central, fim]);
}

export function gerarXlsx(planilhas: Planilha[]): Buffer {
  if (planilhas.length === 0) throw new Error("A planilha precisa de ao menos uma aba.");
  const nomes = planilhas.map((p) => nomeSeguro(p.nome));
  const u = (s: string) => Buffer.from(s, "utf8");

  const arquivos: Arquivo[] = [
    {
      nome: "[Content_Types].xml",
      dados: u(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
          planilhas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
          `</Types>`
      ),
    },
    {
      nome: "_rels/.rels",
      dados: u(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
      ),
    },
    {
      nome: "xl/workbook.xml",
      dados: u(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
          nomes.map((n, i) => `<sheet name="${escapar(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
          `</sheets></workbook>`
      ),
    },
    {
      nome: "xl/_rels/workbook.xml.rels",
      dados: u(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          planilhas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
          `<Relationship Id="rId${planilhas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
      ),
    },
    { nome: "xl/styles.xml", dados: u(ESTILOS_XML) },
    ...planilhas.map((p, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, dados: u(planilhaXml(p)) })),
  ];
  return zip(arquivos);
}
