import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../../middleware";
import { COOKIE_SESSAO } from "../constantes";

function requisicao(caminho: string, opcoes: { cookie?: boolean; cabecalhos?: Record<string, string>; metodo?: string } = {}) {
  const cabecalhos = new Headers(opcoes.cabecalhos);
  if (opcoes.cookie) cabecalhos.set("cookie", `${COOKIE_SESSAO}=token-qualquer`);
  return new NextRequest(`http://localhost:3000${caminho}`, { headers: cabecalhos, method: opcoes.metodo ?? "GET" });
}

describe("middleware — acesso direto a rotas privadas", () => {
  const privadas = ["/", "/pdv", "/dashboard", "/produtos", "/estoque", "/clientes", "/funcionarios", "/contas-receber", "/relatorios", "/historico", "/backup", "/usuarios", "/sincronizacao", "/pin", "/pdv/cupom/123"];

  it.each(privadas)("%s sem cookie redireciona para /login", (caminho) => {
    const resposta = middleware(requisicao(caminho));
    expect(resposta.status).toBe(307);
    const destino = new URL(resposta.headers.get("location")!);
    expect(destino.pathname).toBe("/login");
  });

  it("preserva o destino original no parâmetro next", () => {
    const resposta = middleware(requisicao("/estoque?busca=agua"));
    const destino = new URL(resposta.headers.get("location")!);
    expect(destino.searchParams.get("next")).toBe("/estoque?busca=agua");
  });

  it("com cookie, deixa passar (a validação real é no servidor)", () => {
    const resposta = middleware(requisicao("/pdv", { cookie: true }));
    expect(resposta.headers.get("location")).toBeNull();
    expect(resposta.status).toBe(200);
  });

  it.each(["/login", "/recuperar-senha", "/redefinir-senha", "/offline", "/configurar-conta", "/ativar-conta"])("%s é público", (caminho) => {
    const resposta = middleware(requisicao(caminho));
    expect(resposta.headers.get("location")).toBeNull();
  });

  it("rotas /api/* sem cookie respondem 401 JSON, não redirecionam", async () => {
    const resposta = middleware(requisicao("/api/qualquer-coisa"));
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual({ erro: "Não autenticado." });
  });

  it("Server Actions sem cookie passam, pois respondem sozinhas com erro estruturado (fila offline preservada)", () => {
    const resposta = middleware(requisicao("/pdv", { metodo: "POST", cabecalhos: { "next-action": "abc123" } }));
    expect(resposta.headers.get("location")).toBeNull();
  });

  it("cabeçalho next-action forjado não abre nada: só vale em POST e nunca em /api", async () => {
    const get = middleware(requisicao("/usuarios", { cabecalhos: { "next-action": "abc123" } }));
    expect(get.status).toBe(307);

    const api = middleware(requisicao("/api/x", { metodo: "POST", cabecalhos: { "next-action": "abc123" } }));
    expect(api.status).toBe(401);
  });

  it.each(["GET", "HEAD", "PUT", "PATCH", "DELETE"])("next-action forjado em %s sem cookie não passa (rota privada e administrativa)", (metodo) => {
    for (const caminho of ["/pdv", "/usuarios", "/backup"]) {
      const resposta = middleware(requisicao(caminho, { metodo, cabecalhos: { "next-action": "abc123" } }));
      expect(resposta.status).toBe(307);
      expect(new URL(resposta.headers.get("location")!).pathname).toBe("/login");
    }
    expect(middleware(requisicao("/api/x", { metodo, cabecalhos: { "next-action": "abc123" } })).status).toBe(401);
  });

  it("não aceita um cookie vazio como sessão", () => {
    const cabecalhos = new Headers({ cookie: `${COOKIE_SESSAO}=` });
    const resposta = middleware(new NextRequest("http://localhost:3000/pdv", { headers: cabecalhos }));
    expect(resposta.status).toBe(307);
  });
});
