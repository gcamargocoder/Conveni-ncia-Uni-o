import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { middleware } from "../../../middleware";
import { ROTAS_PUBLICAS, rotaPublica } from "../constantes";

/**
 * Cobertura derivada do código (não de uma lista escrita à mão): se alguém criar uma página, um
 * Route Handler ou uma Server Action fora do padrão, estes testes quebram. Complementa
 * cobertura-guardas.test.ts (que confere a presença do guard em cada action/página).
 */
const RAIZ = path.resolve(__dirname, "../../..");
const IGNORAR = new Set(["node_modules", ".next", "__tests__", ".git", "coverage", "prisma", "public", "scripts", "docs"]);

function listar(dir: string, acumulado: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(e.name)) continue;
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) listar(completo, acumulado);
    else acumulado.push(completo);
  }
  return acumulado;
}
const rel = (a: string) => path.relative(RAIZ, a).split(path.sep).join("/");
const todos = listar(RAIZ);

/** app/(grupo)/estoque/[id]/page.tsx → /estoque/00000000-... */
function urlDaPagina(arquivo: string): string {
  const partes = rel(arquivo)
    .replace(/^app\//, "")
    .replace(/\/?page\.tsx$/, "")
    .split("/")
    .filter((p) => p && !/^\(.*\)$/.test(p))
    .map((p) => (/^\[.+\]$/.test(p) ? "00000000-0000-0000-0000-000000000000" : p));
  return "/" + partes.join("/");
}

const req = (caminho: string, extra: { cabecalhos?: Record<string, string>; metodo?: string } = {}) =>
  new NextRequest(`http://localhost:3000${caminho}`, { headers: new Headers(extra.cabecalhos), method: extra.metodo ?? "GET" });

describe("toda página existente: pública só se estiver em ROTAS_PUBLICAS", () => {
  const paginas = todos.filter((f) => /^app\/.*page\.tsx$/.test(rel(f)));

  it("encontra as páginas", () => expect(paginas.length).toBeGreaterThanOrEqual(20));

  for (const pagina of paginas) {
    const url = urlDaPagina(pagina);
    if (url === "/") continue; // a home redireciona para /pdv; coberta abaixo
    it(`${url}`, () => {
      const resposta = middleware(req(url));
      if (rotaPublica(url)) {
        expect(resposta.headers.get("location"), `${url} é pública`).toBeNull();
      } else {
        expect(resposta.status, `${url} deveria exigir login`).toBe(307);
        expect(new URL(resposta.headers.get("location")!).pathname).toBe("/login");
      }
    });
  }

  it("as únicas páginas públicas são as de entrada/recuperação/ativação e a offline", () => {
    const publicas = paginas.map(urlDaPagina).filter((u) => rotaPublica(u)).sort();
    expect(publicas).toEqual([...ROTAS_PUBLICAS].sort());
  });

  it("a home e qualquer caminho desconhecido também exigem login", () => {
    for (const url of ["/", "/api", "/qualquer-coisa", "/admin", "/pdv/../backup"]) {
      expect(middleware(req(url)).status, url).toBe(307);
    }
  });
});

describe("não há Route Handlers nem API própria sem guard", () => {
  it("não existe route.ts/route.js em app/ (qualquer um novo precisa de guard e destes testes)", () => {
    expect(todos.map(rel).filter((f) => /^app\/.*route\.(ts|js|tsx)$/.test(f))).toEqual([]);
  });

  it("/api/* sem cookie responde 401 (JSON), nunca conteúdo", async () => {
    const r = middleware(req("/api/backup"));
    expect(r.status).toBe(401);
    expect((await r.json()).erro).toMatch(/autenticado/i);
  });
});

describe("cabeçalhos forjados não abrem rotas protegidas", () => {
  const forjados: Record<string, string>[] = [
    { "x-pathname": "/login" },
    { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" },
    { "x-middleware-subrequest": "src/middleware" },
    { "next-action": "abc" },
    { "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1" },
  ];
  it.each(forjados.map((h) => [JSON.stringify(h), h] as const))("GET /pdv com %s → /login", (_n, cabecalhos) => {
    expect(middleware(req("/pdv", { cabecalhos })).status).toBe(307);
  });

  it("next-action só é aceito em POST e fora de /api", () => {
    expect(middleware(req("/pdv", { cabecalhos: { "next-action": "x" }, metodo: "POST" })).status).toBe(200);
    expect(middleware(req("/api/x", { cabecalhos: { "next-action": "x" }, metodo: "POST" })).status).toBe(401);
    expect(middleware(req("/pdv", { cabecalhos: { "next-action": "x" }, metodo: "PUT" })).status).toBe(307);
  });

  it("o middleware sobrescreve o x-pathname enviado pelo cliente (o layout confia nele)", () => {
    const r = middleware(req("/login", { cabecalhos: { "x-pathname": "/qualquer" } }));
    expect(r.headers.get("x-middleware-request-x-pathname")).toBe("/login");
  });
});

describe("Server Actions: nada escapa da varredura de guards", () => {
  const arquivosAction = todos.filter((f) => /\.(ts|tsx)$/.test(f) && /^\s*["']use server["']/.test(fs.readFileSync(f, "utf8")));

  it("só existem arquivos 'use server' nos lugares varridos por cobertura-guardas (lib/**)", () => {
    for (const a of arquivosAction) expect(rel(a), rel(a)).toMatch(/^lib\/.*\.ts$/);
  });

  it("todos exportam apenas 'export async function' (arrow/const/default fugiriam da checagem estática)", () => {
    for (const a of arquivosAction) {
      const exportsNaoFuncao = fs
        .readFileSync(a, "utf8")
        .split("\n")
        .filter((l) => /^export\s+(default|const|let|var|\{|\*)/.test(l));
      expect(exportsNaoFuncao, rel(a)).toEqual([]);
    }
  });

  it("há pelo menos as actions esperadas", () => expect(arquivosAction.length).toBeGreaterThanOrEqual(15));
});
