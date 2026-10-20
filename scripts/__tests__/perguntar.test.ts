import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { perguntar } from "../perguntar";

function terminalFalso() {
  const input = new PassThrough();
  const output = new PassThrough();
  let saida = "";
  output.on("data", (d) => (saida += d.toString()));
  return { input, output, lido: () => saida };
}

// Marcador de "apagar até o fim da tela" que o readline emite ao redesenhar a linha.
const APAGAR = "\x1b[0J";

describe("perguntar (prompt do script de administrador)", () => {
  it("exibe a pergunta DEPOIS do último redesenho de linha, ou seja, ela não é apagada", async () => {
    const t = terminalFalso();
    const p = perguntar("E-mail do administrador: ", false, t);
    t.input.write("alguem@exemplo.com\n");
    expect(await p).toBe("alguem@exemplo.com");
    const saida = t.lido();
    expect(saida).toContain("E-mail do administrador: ");
    expect(saida.lastIndexOf("E-mail do administrador: ")).toBeGreaterThan(saida.lastIndexOf(APAGAR));
  });

  it("exibe a pergunta antes de aceitar a entrada, mesmo que o texto chegue depois", async () => {
    const t = terminalFalso();
    const p = perguntar("Nome: ", false, t);
    expect(t.lido()).toContain("Nome: ");
    t.input.write("Maria\n");
    expect(await p).toBe("Maria");
  });

  it("no modo oculto mostra a pergunta, devolve a resposta e não ecoa o que foi digitado", async () => {
    const t = terminalFalso();
    const segredo = "Valor-Ficticio-De-Teste-123";
    const p = perguntar("Senha (não aparece enquanto digita): ", true, t);
    expect(t.lido()).toContain("Senha (não aparece enquanto digita): ");
    t.input.write(segredo + "\n");
    expect(await p).toBe(segredo);
    expect(t.lido()).not.toContain(segredo);
    expect(t.lido().endsWith("\n")).toBe(true);
  });

  it("perguntas em sequência funcionam (e-mail visível, depois senha oculta)", async () => {
    const t = terminalFalso();
    const a = perguntar("E-mail: ", false, t);
    t.input.write("a@b.co\n");
    expect(await a).toBe("a@b.co");
    const b = perguntar("Senha: ", true, t);
    t.input.write("segredo-ficticio-xyz\n");
    expect(await b).toBe("segredo-ficticio-xyz");
    expect(t.lido()).toContain("E-mail: ");
    expect(t.lido()).toContain("Senha: ");
    expect(t.lido()).not.toContain("segredo-ficticio-xyz");
  });
});
