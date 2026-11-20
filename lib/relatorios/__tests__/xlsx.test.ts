import { describe, expect, it } from "vitest";
import { gerarXlsx, nomeColuna } from "../xlsx";
import { lerZip } from "./ler-zip";

describe("gerarXlsx", () => {
  const xlsx = gerarXlsx([
    {
      nome: "Vendas [x]/y",
      colunas: [{ titulo: "Produto" }, { titulo: "Total" }],
      linhas: [
        ["Água <500ml> & gelo", { centavos: 1050 }],
        ['=HYPERLINK("http://x")', { centavos: 295 }],
        ["Açaí — ção", { centavos: 5 }],
      ],
    },
    { nome: "Vazia", colunas: [{ titulo: "A" }], linhas: [] },
  ]);

  it("gera um ZIP íntegro com as partes obrigatórias do Office Open XML", () => {
    const z = lerZip(xlsx);
    for (const n of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
      expect(z.has(n)).toBe(true);
    }
  });

  it("nome da aba é saneado e o texto é escapado (sem fórmula executável)", () => {
    const z = lerZip(xlsx);
    expect(z.get("xl/workbook.xml")!.toString()).toContain('name="Vendas  x  y"');
    const s1 = z.get("xl/worksheets/sheet1.xml")!.toString();
    expect(s1).toContain("Água &lt;500ml&gt; &amp; gelo");
    expect(s1).toContain("Açaí — ção");
    expect(s1).not.toContain("<f>"); // fórmula é gravada como TEXTO inline, nunca como <f>
    expect(s1).toContain('t="inlineStr"');
    expect(s1).toContain("=HYPERLINK(&quot;http://x&quot;)");
  });

  it("dinheiro vai como número em reais (soma na planilha = soma dos centavos)", () => {
    const s1 = lerZip(xlsx).get("xl/worksheets/sheet1.xml")!.toString();
    const valores = [...s1.matchAll(/<c r="B\d+" s="2"><v>([\d.]+)<\/v><\/c>/g)].map((m) => m[1]);
    expect(valores).toEqual(["10.50", "2.95", "0.05"]);
    expect(valores.reduce((s, v) => s + Math.round(Number(v) * 100), 0)).toBe(1050 + 295 + 5);
  });

  it("nomeColuna: A, Z, AA, AB", () => {
    expect([0, 25, 26, 27].map(nomeColuna)).toEqual(["A", "Z", "AA", "AB"]);
  });

  it("rejeita planilha sem abas", () => {
    expect(() => gerarXlsx([])).toThrow();
  });
});
