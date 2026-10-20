// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * O service worker NÃO pode guardar nem servir dados privados do negócio (clientes, estoque, contas,
 * funcionários...), de modo que a segurança não dependa de o cache ter sido limpo no logout.
 * O public/sw.js real é executado aqui com `caches`/`fetch`/`self` simulados.
 */
const CODIGO = fs.readFileSync(path.resolve(__dirname, "../../../public/sw.js"), "utf8");
const ORIGEM = "https://app.example.com";
const HORA = 60 * 60 * 1000;

type Manipulador = (evento: Record<string, unknown>) => void;

function chave(entrada: unknown): string {
  if (typeof entrada === "string") return entrada.startsWith("/") ? entrada : new URL(entrada).pathname + new URL(entrada).search;
  const u = new URL((entrada as { url: string }).url);
  return u.pathname + u.search;
}

function criarCaches(falharAdd?: string) {
  const mapa = new Map<string, Map<string, Response>>();
  const abrir = (nome: string) => {
    if (!mapa.has(nome)) mapa.set(nome, new Map());
    const m = mapa.get(nome)!;
    return {
      put: async (k: unknown, r: Response) => void m.set(chave(k), r),
      match: async (k: unknown) => m.get(chave(k))?.clone(),
      delete: async (k: unknown) => m.delete(chave(k)),
      keys: async () => [...m.keys()],
      add: async (u: string) => {
        if (u === falharAdd) throw new TypeError("404");
        m.set(chave(u), new Response("shell"));
      },
    };
  };
  return {
    mapa,
    open: async (nome: string) => abrir(nome),
    keys: async () => [...mapa.keys()],
    delete: async (nome: string) => mapa.delete(nome),
    match: async (k: unknown) => {
      for (const m of mapa.values()) if (m.has(chave(k))) return m.get(chave(k))!.clone();
      return undefined;
    },
  };
}

type Rede = {
  falhar: boolean;
  respostas: Record<string, Response | (() => Response)>;
  /** o que o "servidor" devolve ao pedido de cópia neutra; padrão: texto neutro com o cabeçalho de confirmação */
  neutras?: Record<string, Response>;
  falharNeutra?: boolean;
  falharAdd?: string;
};

function carregarSw(rede: Rede) {
  const manipuladores: Record<string, Manipulador[]> = {};
  const caches = criarCaches(rede.falharAdd);
  const self = {
    location: { origin: ORIGEM },
    addEventListener: (tipo: string, fn: Manipulador) => void (manipuladores[tipo] ??= []).push(fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
  };
  const fetchFalso = vi.fn(async (req: { url: string } | string, init?: { headers?: Record<string, string> }) => {
    if (rede.falhar) throw new TypeError("offline");
    const caminho = new URL(typeof req === "string" ? req : req.url, ORIGEM).pathname;
    if (init?.headers?.["x-pagina-neutra"] === "1") {
      if (rede.falharNeutra) throw new TypeError("falha na cópia neutra");
      const n = rede.neutras?.[caminho];
      if (n) return n.clone();
      return new Response("neutra:" + caminho, { status: 200, headers: { "x-pagina-neutra": "1" } });
    }
    const r = rede.respostas[caminho];
    const resposta = typeof r === "function" ? r() : r;
    if (!resposta) return new Response("ok", { status: 200 });
    return resposta.redirected ? resposta : resposta.clone();
  });
  new Function("self", "caches", "fetch", "Response", "Headers", "URL", CODIGO)(self, caches, fetchFalso, Response, Headers, URL);

  const instalado = (async () => {
    const esperas: Promise<unknown>[] = [];
    manipuladores.install.forEach((fn) => fn({ waitUntil: (p: Promise<unknown>) => esperas.push(p) }));
    await Promise.all(esperas);
  })();
  const pedir = async (caminho: string, extra: { modo?: string; cabecalhos?: Record<string, string>; metodo?: string } = {}) => {
    const evento: Record<string, unknown> = {
      request: {
        url: ORIGEM + caminho,
        method: extra.metodo ?? "GET",
        mode: extra.modo ?? "cors",
        headers: new Headers(extra.cabecalhos),
      },
      respondWith(p: Promise<Response>) {
        this.resposta = p;
      },
    };
    await instalado;
    const esperas: Promise<unknown>[] = [];
    evento.waitUntil = (p: Promise<unknown>) => esperas.push(p);
    manipuladores.fetch.forEach((fn) => fn(evento));
    const resposta = evento.resposta ? await (evento.resposta as Promise<Response>) : undefined;
    await Promise.all(esperas); // trabalho em segundo plano (cópia neutra)
    return resposta;
  };
  const disparar = async (tipo: string, evento: Record<string, unknown>) => {
    const esperas: Promise<unknown>[] = [];
    evento.waitUntil = (p: Promise<unknown>) => esperas.push(p);
    manipuladores[tipo].forEach((fn) => fn(evento));
    await Promise.all(esperas);
  };
  const navegar = (caminho: string) => pedir(caminho, { modo: "navigate" });
  const todasAsChaves = () => [...caches.mapa.entries()].flatMap(([n, m]) => [...m.keys()].map((k) => `${n.replace("conveniencia-uniao-", "")}:${k}`));
  return { caches, pedir, navegar, disparar, fetchFalso, self, todasAsChaves };
}

const html = (texto: string) => new Response(`<html>${texto}</html>`, { status: 200, headers: { "content-type": "text/html" } });
const PRIVADAS = ["/clientes", "/estoque", "/contas-receber", "/funcionarios", "/historico", "/relatorios", "/dashboard", "/produtos", "/usuarios", "/backup", "/vendas-revisao", "/pdv/cupom/abc"];

describe("service worker: nada de dados privados no cache", () => {
  let rede: { falhar: boolean; respostas: Record<string, Response | (() => Response)> };
  beforeEach(() => {
    rede = { falhar: false, respostas: {} };
  });
  afterEach(() => vi.useRealTimers());

  it.each(PRIVADAS)("a navegação online para %s NÃO é guardada", async (caminho) => {
    rede.respostas[caminho] = html("Cliente Segredo");
    const sw = carregarSw(rede);
    const r = await sw.navegar(caminho);
    expect(await r!.text()).toContain("Cliente Segredo"); // o usuário logado continua vendo a página
    expect(sw.todasAsChaves().filter((c) => c.includes(caminho))).toEqual([]);
  });

  it.each(PRIVADAS)("offline, %s não é servida nem de um cache já existente (cai em /offline)", async (caminho) => {
    const sw = carregarSw(rede);
    await sw.navegar("/login"); // aguarda a instalação
    // simula cache deixado pela versão antiga / por qualquer outra via
    const antigo = await sw.caches.open("conveniencia-uniao-paginas-v4");
    await antigo.put(caminho, html("Cliente Segredo"));
    rede.falhar = true;
    const r = await sw.navegar(caminho);
    const texto = await r!.text();
    expect(texto).not.toContain("Cliente Segredo");
    expect(texto).toBe("shell"); // a tela /offline
  });

  it("requisições RSC / navegação interna (com dados do negócio) passam direto para a rede, sem cache", async () => {
    rede.respostas["/clientes"] = html("Cliente Segredo");
    const sw = carregarSw(rede);
    for (const [caminho, cab] of [
      ["/clientes?_rsc=abc", { RSC: "1" }],
      ["/estoque?_rsc=xyz", { RSC: "1", "Next-Router-Prefetch": "1" }],
      ["/contas-receber", { RSC: "1" }],
      ["/qualquer/coisa/json", {}],
    ] as const) {
      expect(await sw.pedir(caminho, { cabecalhos: cab })).toBeUndefined(); // sem respondWith
    }
    expect(sw.todasAsChaves().filter((c) => !c.includes("/offline") && !c.includes("/icons") && !c.includes("/logo-"))).toEqual([]);
  });

  it("métodos que não são GET e outras origens nunca são tocados", async () => {
    const sw = carregarSw(rede);
    expect(await sw.pedir("/clientes", { metodo: "POST" })).toBeUndefined();
  });

  it("login e telas de autenticação não são guardados", async () => {
    for (const c of ["/login", "/recuperar-senha", "/redefinir-senha", "/configurar-conta", "/ativar-conta"]) {
      rede.respostas[c] = html("senha");
      const sw = carregarSw(rede);
      await sw.navegar(c);
      expect(sw.todasAsChaves().filter((k) => k.includes(c))).toEqual([]);
    }
  });

  it("respostas redirecionadas (sessão expirada → /login) nunca são guardadas, nem para /pdv", async () => {
    const redirecionada = html("login");
    Object.defineProperty(redirecionada, "redirected", { value: true });
    rede.respostas["/pdv"] = redirecionada;
    const sw = carregarSw(rede);
    await sw.navegar("/pdv");
    expect(sw.todasAsChaves().filter((k) => k.includes("/pdv"))).toEqual([]);
  });

  it("a versão antiga (v2) é apagada ao ativar: dados privados que ela guardou somem", async () => {
    const sw = carregarSw(rede);
    const v2 = await sw.caches.open("conveniencia-uniao-estatico-v2");
    await v2.put("/clientes?_rsc=abc", html("Cliente Segredo"));
    const v2p = await sw.caches.open("conveniencia-uniao-paginas-v2");
    await v2p.put("/estoque", html("estoque"));
    await sw.disparar("activate", {});
    expect(sw.todasAsChaves().filter((k) => k.includes("clientes") || k.includes("estoque"))).toEqual([]);
    expect([...sw.caches.mapa.keys()].some((n) => n.endsWith("-v2"))).toBe(false);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });

  it("LIMPAR_CACHES (logout) apaga tudo e recoloca só o essencial", async () => {
    rede.respostas["/pdv"] = html("pdv");
    const sw = carregarSw(rede);
    await sw.navegar("/pdv");
    expect(sw.todasAsChaves().some((k) => k.includes("paginas-v4:/pdv"))).toBe(true);
    await sw.disparar("message", { data: { tipo: "LIMPAR_CACHES" } });
    expect(sw.todasAsChaves().sort()).toEqual(["estatico-v4:/icons/icon-192.png", "estatico-v4:/icons/icon-512.png", "estatico-v4:/logo-auto-posto-uniao.jpeg", "estatico-v4:/offline.html"]);
  });
});

describe("service worker: o HTML guardado não contém dados da sessão", () => {
  const PESSOAIS = ["Maria", "maria@loja.com", "admin", "usuario-id-123", "2030-01-01T00:00:00.000Z"];
  const personalizada = () => html(PESSOAIS.join(" | "));
  async function tudoQueFicouNoCache(sw: ReturnType<typeof carregarSw>) {
    const textos: string[] = [];
    for (const [nome, m] of sw.caches.mapa.entries()) {
      for (const [k, r] of m.entries()) textos.push(nome + " " + k + " " + [...r.headers.entries()].join(";") + " " + (await r.clone().text()));
    }
    return textos.join("\n");
  }

  it("nada da pessoa logada aparece em qualquer entrada do cache (corpo ou cabeçalhos)", async () => {
    const sw = carregarSw({ falhar: false, respostas: { "/pdv": personalizada(), "/pin": personalizada(), "/sincronizacao": personalizada() } });
    for (const c of ["/pdv", "/pin", "/sincronizacao"]) await sw.navegar(c);
    const guardado = await tudoQueFicouNoCache(sw);
    expect(guardado).toContain("neutra:/pdv");
    for (const p of PESSOAIS) expect(guardado, p).not.toContain(p);
  });

  it("troca de usuário: o cache depois do usuário B não tem nada de A nem de B", async () => {
    const rede: Rede = { falhar: false, respostas: { "/pdv": html("Ana ana@loja.com") } };
    const sw = carregarSw(rede);
    await sw.navegar("/pdv");
    rede.respostas["/pdv"] = html("Bruno bruno@loja.com");
    await sw.navegar("/pdv");
    const guardado = await tudoQueFicouNoCache(sw);
    for (const p of ["Ana", "ana@loja.com", "Bruno", "bruno@loja.com"]) expect(guardado, p).not.toContain(p);
  });

  it("falha fechada: se o servidor NÃO devolver a cópia neutra (sem o cabeçalho de confirmação), nada é guardado", async () => {
    const rede: Rede = { falhar: false, respostas: { "/pdv": personalizada() }, neutras: { "/pdv": personalizada() } };
    const sw = carregarSw(rede);
    await sw.navegar("/pdv");
    expect(sw.todasAsChaves().filter((k) => k.includes("paginas"))).toEqual([]);
    rede.falhar = true;
    expect(await (await sw.navegar("/pdv"))!.text()).toBe("shell");
  });

  it("falha ao buscar a cópia neutra: a página é entregue e nada é guardado", async () => {
    const sw = carregarSw({ falhar: false, falharNeutra: true, respostas: { "/pdv": personalizada() } });
    expect(await (await sw.navegar("/pdv"))!.text()).toContain("Maria");
    expect(sw.todasAsChaves().filter((k) => k.includes("paginas"))).toEqual([]);
  });

  it("entrada antiga SEM o marcador de cópia neutra (ex.: guardada por versão anterior) nunca é servida", async () => {
    const rede: Rede = { falhar: false, respostas: {} };
    const sw = carregarSw(rede);
    await sw.navegar("/login"); // instala
    const paginas = await sw.caches.open("conveniencia-uniao-paginas-v4");
    await paginas.put("/pdv", new Response("Maria maria@loja.com", { headers: { "x-sw-guardado-em": String(Date.now()) } }));
    rede.falhar = true;
    const texto = await (await sw.navegar("/pdv"))!.text();
    expect(texto).not.toContain("Maria");
    expect(texto).toBe("shell");
  });

  it("depois do logout (LIMPAR_CACHES) não resta nenhuma página guardada", async () => {
    const sw = carregarSw({ falhar: false, respostas: { "/pdv": personalizada() } });
    await sw.navegar("/pdv");
    await sw.disparar("message", { data: { tipo: "LIMPAR_CACHES" } });
    expect(sw.todasAsChaves().filter((k) => k.includes("paginas"))).toEqual([]);
  });
});

describe("service worker: tela offline estática (/offline.html)", () => {
  const ARQ = fs.readFileSync(path.resolve(__dirname, "../../../public/offline.html"), "utf8");

  it("o fallback é o arquivo estático pré-cacheado; a rota React /offline nunca é guardada nem usada", async () => {
    const rede: Rede = { falhar: false, respostas: { "/offline": html("Maria maria@loja.com admin") } };
    const sw = carregarSw(rede);
    await sw.navegar("/login");
    expect(sw.todasAsChaves()).toContain("estatico-v4:/offline.html");
    expect(sw.todasAsChaves().some((k) => k.endsWith(":/offline"))).toBe(false);
    rede.falhar = true;
    expect(await (await sw.navegar("/clientes"))!.text()).toBe("shell");
    expect(await (await sw.navegar("/offline"))!.text()).toBe("shell"); // mesmo abrir /offline sem rede cai no estático
  });

  it("logo e ícones pedidos pela tela offline saem do pré-cache (sem rede)", async () => {
    const rede: Rede = { falhar: false, respostas: {} };
    const sw = carregarSw(rede);
    await sw.navegar("/login");
    rede.falhar = true;
    expect((await sw.pedir("/logo-auto-posto-uniao.jpeg"))!.ok).toBe(true);
    expect((await sw.pedir("/icons/icon-192.png"))!.ok).toBe(true);
  });

  it("o arquivo é autossuficiente: sem scripts/estilos/imagens externos, sem /_next, sem fontes remotas", () => {
    expect(ARQ).not.toMatch(/<script[^>]+src=/i);
    expect(ARQ).not.toMatch(/<link[^>]+(stylesheet|preload|modulepreload)/i);
    expect(ARQ).not.toMatch(/_next\//);
    expect(ARQ).not.toMatch(/https?:\/\//i);
    const imagens = [...ARQ.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1]);
    expect(imagens).toEqual(["/logo-auto-posto-uniao.jpeg"]); // só o logo, que o pré-cache guarda
    expect(fs.existsSync(path.resolve(__dirname, "../../../public/logo-auto-posto-uniao.jpeg"))).toBe(true);
  });

  it("não carrega dados de sessão nem de negócio e não faz requisições de rede", () => {
    expect(ARQ).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
    expect(ARQ).not.toMatch(/localStorage|sessionStorage|document\.cookie|sessao_offline|nome|e-mail|papel/i);
  });

  it("só LÊ o IndexedDB (contagem da fila) e nunca altera: sem put/add/delete/clear/version/upgrade", () => {
    expect(ARQ).toMatch(/"readonly"/);
    expect(ARQ).not.toMatch(/readwrite|\.put\(|\.add\(|\.delete\(|\.clear\(|deleteDatabase|onupgradeneeded|createObjectStore|indexedDB\.open\([^)]*,/);
    expect(ARQ).toMatch(/indexedDB\.databases/); // só abre se o banco já existir
  });

  it("o middleware não redireciona /offline.html para o login (precisa abrir sem sessão)", async () => {
    const { config } = await import("../../../middleware");
    const padrao = new RegExp("^" + config.matcher[0].replace(/\(\?!/, "(?!") + "$");
    expect(padrao.test("/offline.html")).toBe(false); // excluído do middleware
    expect(padrao.test("/pdv")).toBe(true);
    expect(padrao.test("/clientes")).toBe(true);
  });
});

describe("service worker: o PDV continua funcionando offline", () => {
  it("um recurso do pré-cache que falha não derruba a tela /offline (nem após o LIMPAR_CACHES)", async () => {
    const rede: Rede = { falhar: false, respostas: {}, falharAdd: "/icons/icon-512.png" };
    const sw = carregarSw(rede);
    await sw.navegar("/login"); // instala online (o service worker só se instala com rede)
    rede.falhar = true;
    expect(await (await sw.navegar("/clientes"))!.text()).toBe("shell");
    rede.falhar = false;
    await sw.disparar("message", { data: { tipo: "LIMPAR_CACHES" } });
    rede.falhar = true;
    expect(await (await sw.navegar("/estoque"))!.text()).toBe("shell");
  });

  it.each(["/pdv", "/pin", "/sincronizacao"])("%s é guardada online e servida offline", async (caminho) => {
    const rede: Rede = { falhar: false, respostas: { [caminho]: html("tela " + caminho) } };
    const sw = carregarSw(rede);
    await sw.navegar(caminho);
    rede.falhar = true;
    const r = await sw.navegar(caminho);
    expect(await r!.text()).toBe("neutra:" + caminho); // a cópia guardada, não a original
  });

  it("a query string não cria entradas separadas nem impede o uso offline", async () => {
    const rede: Rede = { falhar: false, respostas: { "/pdv": html("pdv") } };
    const sw = carregarSw(rede);
    await sw.navegar("/pdv?x=1");
    rede.falhar = true;
    expect(await (await sw.navegar("/pdv"))!.text()).toBe("neutra:/pdv");
  });

  it("chunks estáticos, ícones e o manifest continuam em cache (carregar o app offline)", async () => {
    const rede = { falhar: false, respostas: {} as Record<string, Response> };
    const sw = carregarSw(rede);
    await sw.pedir("/_next/static/chunks/app.js");
    await sw.pedir("/icons/icon-96.png");
    await sw.pedir("/manifest.webmanifest");
    rede.falhar = true;
    expect(await sw.pedir("/_next/static/chunks/app.js")).toBeDefined();
    expect((await sw.pedir("/_next/static/chunks/app.js"))!.ok).toBe(true);
    expect((await sw.pedir("/icons/icon-96.png"))!.ok).toBe(true);
    expect((await sw.pedir("/manifest.webmanifest"))!.ok).toBe(true);
  });

  it("uma página do PDV guardada há mais de 72 h deixa de ser servida (e é descartada)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const rede: Rede = { falhar: false, respostas: { "/pdv": html("pdv") } };
    const sw = carregarSw(rede);
    await sw.navegar("/pdv");
    rede.falhar = true;
    vi.setSystemTime(Date.now() + 71 * HORA);
    expect(await (await sw.navegar("/pdv"))!.text()).toBe("neutra:/pdv");
    vi.setSystemTime(Date.now() + 2 * HORA);
    expect(await (await sw.navegar("/pdv"))!.text()).toBe("shell");
    expect(sw.todasAsChaves().some((k) => k.includes("paginas-v4:/pdv"))).toBe(false);
    vi.useRealTimers();
  });

  it("o usuário recebe a página normal (com a identidade dele); só a cópia neutra vai para o cache", async () => {
    const sw = carregarSw({ falhar: false, respostas: { "/pdv": html("Maria maria@loja.com admin") } });
    expect(await (await sw.navegar("/pdv"))!.text()).toContain("Maria maria@loja.com");
  });

  it("o service worker não toca em IndexedDB (fila de vendas pendentes fica intacta)", () => {
    expect(CODIGO).not.toMatch(/indexedDB|IDBFactory|Dexie|deleteDatabase/);
  });
});
