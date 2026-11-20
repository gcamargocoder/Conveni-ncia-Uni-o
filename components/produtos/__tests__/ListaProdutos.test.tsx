import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../ProdutoEditarModal", () => ({ ProdutoEditarModal: () => null }));

import { LINHAS_POR_VEZ, ListaProdutos } from "../ListaProdutos";

const p = (id: string, nome: string, extra: object = {}) =>
  ({ id, nome, preco_venda: 5, estoque_minimo: 1, ativo: true, ...extra }) as never;

describe("ListaProdutos (renderização inicial; a digitação é validada no navegador)", () => {
  const produtos = [p("1", "Água 500ml"), p("2", "Pão de Queijo")];
  const html = renderToStaticMarkup(<ListaProdutos produtos={produtos} total={2} categorias={[]} fornecedores={[]} />);

  it("mostra a caixa de pesquisa com o placeholder pedido", () => {
    expect(html).toContain('placeholder="Pesquisar produto pelo nome..."');
    expect(html).toContain('aria-label="Pesquisar produto pelo nome..."');
  });
  it("sem pesquisa lista todos e conta o total", () => {
    expect(html).toContain("Água 500ml");
    expect(html).toContain("Pão de Queijo");
    expect(html).toContain("Cadastrados (2)");
  });
  it("lista vazia mostra a mensagem de cadastro, não a de pesquisa", () => {
    const v = renderToStaticMarkup(<ListaProdutos produtos={[]} total={0} categorias={[]} fornecedores={[]} />);
    expect(v).toContain("Nenhum produto cadastrado ainda");
  });
  it("lista grande desenha só uma fatia e oferece 'Mostrar mais' (a pesquisa continua sobre todos)", () => {
    const muitos = Array.from({ length: LINHAS_POR_VEZ + 50 }, (_, i) => p(String(i), `Produto ${String(i).padStart(4, "0")}`));
    const g = renderToStaticMarkup(<ListaProdutos produtos={muitos} total={muitos.length} categorias={[]} fornecedores={[]} />);
    expect(g).toContain(`Exibindo ${LINHAS_POR_VEZ} de ${muitos.length} produtos`);
    expect(g).toContain("Mostrar mais 50");
    expect(g).toContain("Produto 0099");
    expect(g).not.toContain("Produto 0100");
    expect(g).toContain(`Cadastrados (${muitos.length})`);
  });
  it("lista pequena não mostra o rodapé de paginação", () => {
    expect(html).not.toContain("Mostrar mais");
  });
  it("catálogo completo: sem aviso de limite", () => {
    expect(html).not.toContain("Limite de carregamento");
  });
  it("catálogo maior que o carregado: mostra total, carregados e quantos ficaram de fora (nunca 'N de 500' como total)", () => {
    const l = renderToStaticMarkup(<ListaProdutos produtos={produtos} total={3500} categorias={[]} fornecedores={[]} />);
    expect(l).toContain("Cadastrados (3500) — 2 carregados");
    expect(l).toContain("há 3500 produtos cadastrados, mas só os primeiros 2");
    expect(l).toContain("não alcança os outros 3498");
  });
});
