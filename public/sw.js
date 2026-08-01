const CACHE_VERSION = "v1";
const CACHE_ESTATICO = `conveniencia-uniao-estatico-${CACHE_VERSION}`;
const CACHE_PAGINAS = `conveniencia-uniao-paginas-${CACHE_VERSION}`;
const CACHE_IMAGENS = `conveniencia-uniao-imagens-${CACHE_VERSION}`;

const APP_SHELL = [
  "/offline",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/favicon.ico",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_ESTATICO)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evento) => {
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
});

self.addEventListener("fetch", (evento) => {
  const requisicao = evento.request;
  const url = new URL(requisicao.url);

  if (requisicao.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  if (requisicao.mode === "navigate") {
    evento.respondWith(estrategiaNetworkFirst(requisicao));
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

  evento.respondWith(estrategiaStaleWhileRevalidate(requisicao, CACHE_ESTATICO));
});

async function estrategiaNetworkFirst(requisicao) {
  try {
    const resposta = await fetch(requisicao);
    const cache = await caches.open(CACHE_PAGINAS);
    cache.put(requisicao, resposta.clone());
    return resposta;
  } catch {
    const cache = await caches.open(CACHE_PAGINAS);
    const emCache = await cache.match(requisicao);
    if (emCache) return emCache;
    const offline = await caches.match("/offline");
    return offline ?? Response.error();
  }
}

async function estrategiaCacheFirst(requisicao, nomeCache) {
  const cache = await caches.open(nomeCache);
  const emCache = await cache.match(requisicao);
  if (emCache) return emCache;

  try {
    const resposta = await fetch(requisicao);
    cache.put(requisicao, resposta.clone());
    return resposta;
  } catch {
    return Response.error();
  }
}

async function estrategiaStaleWhileRevalidate(requisicao, nomeCache) {
  const cache = await caches.open(nomeCache);
  const emCache = await cache.match(requisicao);

  const buscaDeRede = fetch(requisicao)
    .then((resposta) => {
      cache.put(requisicao, resposta.clone());
      return resposta;
    })
    .catch(() => undefined);

  return emCache ?? (await buscaDeRede) ?? Response.error();
}