import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { middleware } from "../../../middleware";
import { COOKIE_SESSAO } from "../constantes";
import { CHAVE_MARCADOR, gravarMarcador, lerMarcador } from "../sessao-offline";

const RAIZ = path.resolve(__dirname, "../../..");
const ler = (arq: string) => fs.readFileSync(path.join(RAIZ, arq), "utf8");

function req(caminho: string, cabecalhos: Record<string, string> = {}) {
  const h = new Headers(cabecalhos);
  h.set("cookie", `${COOKIE_SESSAO}=token-qualquer`);
  return new NextRequest(`http://localhost:3000${caminho}`, { headers: h });
}

describe("cópia neutra do HTML (a que o service worker guarda)", () => {
  it("o middleware confirma o pedido neutro com o mesmo cabeçalho; sem o pedido, não o põe", () => {
    expect(middleware(req("/pdv", { "x-pagina-neutra": "1" })).headers.get("x-pagina-neutra")).toBe("1");
    expect(middleware(req("/pdv")).headers.get("x-pagina-neutra")).toBeNull();
    expect(middleware(req("/pdv", { "x-pagina-neutra": "0" })).headers.get("x-pagina-neutra")).toBeNull();
  });

  it("o layout raiz tira da cópia neutra TODOS os dados da sessão (usuário e validade) e avisa o cliente", () => {
    const layout = ler("app/layout.tsx");
    expect(layout).toMatch(/cabecalhos\.get\("x-pagina-neutra"\) === "1"/);
    expect(layout).toMatch(/usuario=\{sessao && !neutra \?/);
    expect(layout).toMatch(/expiraAbsolutaEm=\{sessao && !neutra \?/);
    expect(layout).toMatch(/neutro=\{neutra\}/);
  });

  it("nenhum outro ponto do layout nem das páginas do PDV injeta a pessoa no HTML", () => {
    const layout = ler("app/layout.tsx");
    // a única passagem de dados da pessoa para componentes é o SessaoProvider
    expect(layout.match(/sessao\.usuario/g)?.length ?? 0).toBeLessThanOrEqual(4);
    for (const arq of ["app/pdv/page.tsx", "app/(auth)/pin/page.tsx", "app/(dashboard)/sincronizacao/page.tsx"]) {
      expect(ler(arq), arq).not.toMatch(/sessao\.usuario|\.nome\b|\.email\b/);
    }
  });

  it("o marcador local guarda nome e papel (para a interface offline), nunca e-mail", () => {
    const mem = new Map<string, string>();
    const arm = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    gravarMarcador(arm, { usuarioId: "u1", nome: "Maria", papel: "admin", ultimaValidacaoEm: 1, expiraAbsolutaEm: 2 });
    expect(lerMarcador(arm)).toMatchObject({ nome: "Maria", papel: "admin" });
    expect(mem.get(CHAVE_MARCADOR)).not.toMatch(/@/);
  });

  it("marcador antigo (sem papel) continua válido e o papel fica indefinido (interface com o menor privilégio)", () => {
    const arm = { getItem: () => JSON.stringify({ usuarioId: "u1", nome: "Maria", ultimaValidacaoEm: 1, expiraAbsolutaEm: 2 }) };
    const m = lerMarcador(arm);
    expect(m).not.toBeNull();
    expect(m!.papel).toBeUndefined();
  });

  it("papel inválido no marcador é ignorado", () => {
    const arm = { getItem: () => JSON.stringify({ usuarioId: "u1", nome: "M", papel: "root", ultimaValidacaoEm: 1, expiraAbsolutaEm: 2 }) };
    expect(lerMarcador(arm)!.papel).toBeUndefined();
  });
});
