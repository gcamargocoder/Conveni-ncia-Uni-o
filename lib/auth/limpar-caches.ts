/**
 * Pede ao service worker para apagar os caches de páginas (que guardam dados
 * do negócio vistos por quem estava logado). Usado no logout, no login (outra
 * pessoa pode ter usado o aparelho) e quando o servidor encerra a sessão.
 * Melhor esforço: sem service worker ativo, não há o que limpar.
 */
export async function limparCachesDoServiceWorker(): Promise<void> {
  try {
    const registro = await navigator.serviceWorker?.getRegistration();
    registro?.active?.postMessage({ tipo: "LIMPAR_CACHES" });
    await new Promise((resolver) => setTimeout(resolver, 150));
  } catch {
    // nada a fazer
  }
}
