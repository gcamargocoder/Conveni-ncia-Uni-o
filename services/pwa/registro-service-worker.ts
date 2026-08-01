export interface ResultadoRegistroServiceWorker {
  registro: ServiceWorkerRegistration | null;
  suportado: boolean;
}

export async function registrarServiceWorker(
  aoEncontrarAtualizacao: (registro: ServiceWorkerRegistration) => void
): Promise<ResultadoRegistroServiceWorker> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return { registro: null, suportado: false };
  }

  try {
    const registro = await navigator.serviceWorker.register("/sw.js");

    registro.addEventListener("updatefound", () => {
      const novoWorker = registro.installing;
      if (!novoWorker) return;

      novoWorker.addEventListener("statechange", () => {
        if (novoWorker.state === "installed" && navigator.serviceWorker.controller) {
          aoEncontrarAtualizacao(registro);
        }
      });
    });

    return { registro, suportado: true };
  } catch {
    return { registro: null, suportado: true };
  }
}

export function ativarNovaVersao(registro: ServiceWorkerRegistration): void {
  registro.waiting?.postMessage({ tipo: "SKIP_WAITING" });
}