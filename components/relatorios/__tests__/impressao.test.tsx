import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CabecalhoRelatorios } from "../CabecalhoRelatorios";
import { ImpressaoRelatorios } from "../ImpressaoRelatorios";
import { descreverFiltros } from "@/lib/relatorios/descrever-filtros";
import type { FiltroVendas } from "@/lib/relatorios/filtro";

const impressao = {
  rotuloPeriodo: "10/03/2026 a 12/03/2026",
  filtrosAplicados: ["Funcionário: Ana", "Forma de pagamento: Pix"],
  truncado: false,
  resumoPagamento: [{ forma_pagamento: "pix", quantidade: 2, total: 80 }],
  totalGeral: 80,
  vendas: [
    { id: "v1", created_at: "2026-03-10T12:00:00.000Z", funcionario_nome: "Ana", total: 30, forma_pagamento: "pix", cancelada: false },
    { id: "v2", created_at: "2026-03-10T13:00:00.000Z", funcionario_nome: "Ana", total: 50, forma_pagamento: "pix", cancelada: true },
  ],
  estoque: [{ produto_id: "p1", nome: "Água", quantidade_atual: 3, estoque_minimo: 5 }] as never,
  contasFiadoPendentes: [],
};

/** Percorre o HTML e devolve, para cada elemento com a classe, as classes de TODOS os seus ancestrais. */
function ancestrais(html: string, classe: string): string[][] {
  const achados: string[][] = [];
  const pilha: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g)) {
    const [, fecha, tag, resto] = m;
    if (fecha) {
      pilha.pop();
      continue;
    }
    const cls = /class="([^"]*)"/.exec(resto)?.[1] ?? "";
    if (cls.split(/\s+/).includes(classe)) achados.push([...pilha]);
    if (!/\/$/.test(resto) && !["img", "input", "br", "hr", "meta", "link"].includes(tag.toLowerCase())) pilha.push(cls);
  }
  return achados;
}

describe("impressão do relatório — estrutura (a impressão física é validada no navegador)", () => {
  const html = renderToStaticMarkup(<CabecalhoRelatorios consulta="de=2026-03-10" impressao={impressao} />);

  it("REGRESSÃO da página em branco: nenhum ancestral do bloco print-only é no-print", () => {
    const blocos = ancestrais(html, "print-only");
    expect(blocos).toHaveLength(1);
    for (const cadeia of blocos[0] ? [blocos[0]] : []) {
      expect(cadeia.some((c) => c.split(/\s+/).includes("no-print"))).toBe(false);
    }
  });

  it("título da tela e botões ficam fora da impressão (no-print)", () => {
    expect(ancestrais(html, "no-print").length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("Exportar Excel");
  });

  it("o bloco impresso traz título, período, filtros, totais e as tabelas", () => {
    const area = html.slice(html.indexOf('class="print-only"'));
    expect(area).toContain("Relatório Geral");
    expect(area).toContain("10/03/2026 a 12/03/2026");
    expect(area).toContain("Funcionário: Ana · Forma de pagamento: Pix");
    expect(area).toContain("Total geral: R$ 80.00");
    expect(area).toContain("Vendas do período (2)");
    expect(area).toContain("(cancelada)");
    expect(area).toContain("Estoque completo (1)");
    expect(area).toContain("Estoque baixo (mín: 5)");
  });

  it("valores monetários não quebram de linha", () => {
    expect(html).toContain('whitespace-nowrap">R$ 30.00');
  });
});

describe("ImpressaoRelatorios — avisos", () => {
  it("sem filtros diz explicitamente que não há; truncado avisa lista parcial", () => {
    const h = renderToStaticMarkup(<ImpressaoRelatorios {...impressao} filtrosAplicados={[]} truncado />);
    expect(h).toContain("Nenhum (todas as vendas do período)");
    expect(h).toContain("Lista parcial");
  });
  it("sem dados: em vez de tabela só com cabeçalho, imprime a frase de vazio", () => {
    const h = renderToStaticMarkup(
      <ImpressaoRelatorios {...impressao} resumoPagamento={[]} totalGeral={0} vendas={[]} estoque={[] as never} contasFiadoPendentes={[]} />
    );
    expect(h).not.toContain("<table");
    expect(h).toContain("Nenhuma venda no período.");
    expect(h).toContain("Nenhum produto cadastrado.");
    expect(h).toContain("Nenhuma conta fiado em aberto.");
  });
  it("títulos de seção não ficam órfãos no fim da página", () => {
    expect(renderToStaticMarkup(<ImpressaoRelatorios {...impressao} />)).toContain("break-after-avoid");
  });
  it("completo não mostra o aviso de lista parcial", () => {
    expect(renderToStaticMarkup(<ImpressaoRelatorios {...impressao} />)).not.toContain("Lista parcial");
  });
});

describe("descreverFiltros", () => {
  const base: FiltroVendas = {
    dataInicial: "2026-03-10",
    dataFinal: "2026-03-10",
    horaInicial: null,
    horaFinal: null,
    funcionario_id: null,
    terminal_id: null,
    caixa_id: null,
    forma: null,
    situacao: "todas",
  };
  const r = { funcionario: "Ana", terminal: "Caixa 1", turno: "Turno X" };

  it("sem restrição: lista vazia", () => expect(descreverFiltros(base, r)).toEqual([]));
  it("combinação de filtros", () => {
    expect(
      descreverFiltros({ ...base, funcionario_id: "f", terminal_id: "t", forma: "pix", situacao: "canceladas", caixa_id: "c" }, r)
    ).toEqual(["Funcionário: Ana", "Terminal: Caixa 1", "Forma de pagamento: Pix", "Situação: Canceladas", "Turno: Turno X"]);
  });
  it("sem rótulo conhecido usa texto neutro, sem vazar o id do funcionário", () => {
    expect(descreverFiltros({ ...base, funcionario_id: "uuid-secreto" }, { funcionario: null, terminal: null, turno: null })).toEqual(["Funcionário: selecionado"]);
  });
});
