// v4: o cache offline guarda SOMENTE o necessário para o PDV funcionar sem internet. Nenhuma página
// ou resposta com dados do negócio (clientes, estoque, contas, funcionários, histórico...) é
// guardada ou servida pelo service worker — logo não há o que vazar após o logout ou com a sessão
// expirada, e a segurança não depende de o cache ter sido limpo. Os dados offline do PDV ficam no
// IndexedDB (catálogo e fila de vendas), que este arquivo nunca toca.
const CACHE_VERSION = "v4";
const CACHE_ESTATICO = `conveniencia-uniao-estatico-${CACHE_VERSION}`;
const CACHE_PAGINAS = `conveniencia-uniao-paginas-${CACHE_VERSION}`;
const CACHE_IMAGENS = `conveniencia-uniao-imagens-${CACHE_VERSION}`;

// Pré-cache: a tela de fallback é o ARQUIVO ESTÁTICO /offline.html (sem Next.js, sem layout, sem
// chunks, sem dados de sessão — por isso não precisa de "cópia neutra"), mais o logo e os ícones que
// ela usa. A rota /offline do app NÃO serve de fallback: é uma página React que precisa de chunks de
// JavaScript e de /_next/image que não estão em cache sem rede (resultava em "Application error").
const TELA_OFFLINE = "/offline.html";
const APP_SHELL = [
  TELA_OFFLINE,
  "/logo-auto-posto-uniao.jpeg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Um a um, tolerando falha de um item: antes, um único recurso inexistente (/favicon.ico, que não
// existe no projeto e responde 404 com sessão) derrubava o addAll inteiro e deixava o aparelho SEM a
// tela /offline depois do login ou do logout (o fallback virava a página de erro do navegador).
async function precarregar(cache) {
  await Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => undefined)));
}

// Únicas páginas (documentos HTML) que podem ser guardadas e servidas offline. O HTML delas não traz
// dados do negócio: o catálogo, o carrinho e a fila vêm do IndexedDB. Qualquer outra rota offline
// cai na tela de fallback estática.
const PAGINAS_OFFLINE = ["/pdv", "/pin", "/sincronizacao"];

// O HTML que vai para o cache NUNCA é o que o usuário recebeu: é uma "cópia neutra", pedida à parte com
// este cabeçalho, em que o servidor omite nome, e-mail, papel, id e validade da sessão (app/layout.tsx).
// Só é guardada se a resposta confirmar o cabeçalho (falha fechada). Assim o HTML guardado não contém
// dados da sessão anterior, haja ou não logout, expiração ou revogação.
const CABECALHO_NEUTRA = "x-pagina-neutra";

// Mesmo teto de uso offline do cliente (NEXT_PUBLIC_SESSAO_OFFLINE_HORAS, padrão 72 h): uma página
// guardada há mais tempo que isso não é mais servida.
const VALIDADE_PAGINA_MS = 72 * 60 * 60 * 1000;
const CABECALHO_GUARDADO_EM = "x-sw-guardado-em";

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_ESTATICO)
      .then((cache) => precarregar(cache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evento) => {
  // Apaga os caches de versões anteriores (a v2 guardava páginas e respostas RSC com dados do negócio).
  const cachesValidos = [CACHE_ESTATICO, CACHE_PAGINAS, CACHE_IMAGENS];
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(
          nomes
            .filter((nome) => !cachesValidos.includes(nome))
            .map((nome) => caches.delete(nome))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (evento) => {
  if (evento.data?.tipo === "SKIP_WAITING") {
    self.skipWaiting();
  }

  // Logout/login/sessão encerrada: apaga tudo e recoloca só o essencial. Reforço — a proteção
  // principal é não guardar dados privados (ver topo do arquivo).
  if (evento.data?.tipo === "LIMPAR_CACHES") {
    evento.waitUntil(
      caches
        .keys()
        .then((nomes) => Promise.all(nomes.map((nome) => caches.delete(nome))))
        .then(() => caches.open(CACHE_ESTATICO))
        .then((cache) => precarregar(cache))
    );
  }
});

function ehPaginaOffline(url) {
  return PAGINAS_OFFLINE.includes(url.pathname);
}

// Só vale guardar respostas finais e bem-sucedidas das páginas da lista. Uma resposta redirecionada
// (ex.: /pdv → /login quando a sessão expirou) nunca é guardada.
function podeGuardarPagina(url, resposta) {
  if (!resposta || !resposta.ok || resposta.redirected || resposta.type === "opaqueredirect") return false;
  return ehPaginaOffline(url);
}

// Chave = só o caminho (sem query), para não acumular variações.
async function guardarPagina(url, resposta) {
  const corpo = await resposta.clone().arrayBuffer();
  const cabecalhos = new Headers(resposta.headers);
  cabecalhos.set(CABECALHO_GUARDADO_EM, String(Date.now()));
  const cache = await caches.open(CACHE_PAGINAS);
  await cache.put(url.pathname, new Response(corpo, { status: resposta.status, statusText: resposta.statusText, headers: cabecalhos }));
}

// Pede ao servidor a cópia neutra da página e a guarda (se não vier neutra, não guarda nada).
async function guardarCopiaNeutra(url) {
  const resposta = await fetch(url.origin + url.pathname, {
    headers: { [CABECALHO_NEUTRA]: "1" },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!podeGuardarPagina(url, resposta) || resposta.headers.get(CABECALHO_NEUTRA) !== "1") return;
  await guardarPagina(url, resposta);
}

async function lerPaginaGuardada(url) {
  if (!ehPaginaOffline(url)) return undefined;
  const cache = await caches.open(CACHE_PAGINAS);
  const guardada = await cache.match(url.pathname);
  if (!guardada) return undefined;
  const guardadaEm = Number(guardada.headers.get(CABECALHO_GUARDADO_EM));
  const neutra = guardada.headers.get(CABECALHO_NEUTRA) === "1";
  if (!neutra || !Number.isFinite(guardadaEm) || Date.now() - guardadaEm > VALIDADE_PAGINA_MS) {
    await cache.delete(url.pathname);
    return undefined;
  }
  return guardada;
}

self.addEventListener("fetch", (evento) => {
  const requisicao = evento.request;
  const url = new URL(requisicao.url);

  if (requisicao.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  if (requisicao.mode === "navigate") {
    evento.respondWith(estrategiaNetworkFirst(requisicao, url, evento));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    evento.respondWith(estrategiaCacheFirst(requisicao, CACHE_ESTATICO));
    return;
  }

  if (url.pathname.startsWith("/icons/") || /\.(png|jpe?g|svg|webp|ico)$/.test(url.pathname)) {
    evento.respondWith(estrategiaCacheFirst(requisicao, CACHE_IMAGENS));
    return;
  }

  if (url.pathname === "/manifest.webmanifest" || url.pathname === "/_next/image") {
    evento.respondWith(estrategiaStaleWhileRevalidate(requisicao, CACHE_ESTATICO));
    return;
  }

  // Todo o resto (inclusive as requisições RSC de navegação interna, que carregam dados do
  // negócio) passa direto para a rede: não é guardado nem servido pelo service worker.
});

async function estrategiaNetworkFirst(requisicao, url, evento) {
  try {
    const resposta = await fetch(requisicao);
    if (podeGuardarPagina(url, resposta)) {
      // a resposta entregue ao usuário (com a identidade dele) NÃO vai para o cache; em segundo plano
      // guarda-se a cópia neutra. Falha aqui (sem espaço, offline) não afeta a página entregue.
      evento.waitUntil(guardarCopiaNeutra(url).catch(() => undefined));
    }
    return resposta;
  } catch {
    const emCache = await lerPaginaGuardada(url);
    if (emCache) return emCache;
    const offline = await caches.match(TELA_OFFLINE);
    return offline ?? Response.error();
  }
}

async function estrategiaCacheFirst(requisicao, nomeCache) {
  const cache = await caches.open(nomeCache);
  const emCache = await cache.match(requisicao);
  if (emCache) return emCache;

  try {
    const resposta = await fetch(requisicao);
    if (resposta.ok && !resposta.redirected) cache.put(requisicao, resposta.clone());
    return resposta;
  } catch {
    // sem rede: o logo/ícones do pré-cache (cache estático) também servem a quem os pede (tela offline)
    return (await caches.match(requisicao)) ?? Response.error();
  }
}

async function estrategiaStaleWhileRevalidate(requisicao, nomeCache) {
  const cache = await caches.open(nomeCache);
  const emCache = await cache.match(requisicao);

  const buscaDeRede = fetch(requisicao)
    .then((resposta) => {
      if (resposta.ok && !resposta.redirected) cache.put(requisicao, resposta.clone());
      return resposta;
    })
    .catch(() => undefined);

  return emCache ?? (await buscaDeRede) ?? Response.error();
}
