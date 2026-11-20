import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Modal } from "../Modal";

const html = (props: Partial<Parameters<typeof Modal>[0]> = {}) =>
  renderToStaticMarkup(
    <Modal aberto titulo="Autorizar" onFechar={() => {}} {...props}>
      <p>conteúdo</p>
    </Modal>
  );

describe("Modal — marcação acessível (o teclado é verificado no navegador real; o projeto não tem jsdom)", () => {
  it("fechado não renderiza nada", () => {
    expect(html({ aberto: false })).toBe("");
  });

  it("é um diálogo modal nomeado, focável por script (tabindex=-1) e com botão Fechar nomeado", () => {
    const h = html();
    expect(h).toContain('role="dialog"');
    expect(h).toContain('aria-modal="true"');
    expect(h).toContain('aria-labelledby="modal-titulo"');
    expect(h).toContain('tabindex="-1"');
    expect(h).toContain('aria-label="Fechar"');
    expect(h).not.toContain("aria-disabled");
  });

  it("bloqueado (operação em andamento): o botão Fechar fica marcado como desabilitado", () => {
    const h = html({ bloqueado: true });
    expect(h).toContain('aria-disabled="true"');
    expect(h).toContain("cursor-not-allowed");
  });
});
