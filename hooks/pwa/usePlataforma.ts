"use client";

import { useEffect, useState } from "react";

export type SistemaOperacional = "ios" | "android" | "windows" | "macos" | "outro";

export interface InfoPlataforma {
  sistemaOperacional: SistemaOperacional;
  instalado: boolean;
  podeInstalarNativo: boolean;
}

function detectarSistemaOperacional(userAgent: string): SistemaOperacional {
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (/android/i.test(userAgent)) return "android";
  if (/windows/i.test(userAgent)) return "windows";
  if (/macintosh|mac os x/i.test(userAgent)) return "macos";
  return "outro";
}

const PADRAO: InfoPlataforma = {
  sistemaOperacional: "outro",
  instalado: false,
  podeInstalarNativo: false,
};

export function usePlataforma(): InfoPlataforma {
  const [info, setInfo] = useState<InfoPlataforma>(PADRAO);

  useEffect(() => {
    const navegadorComPadraoIOS = window.navigator as Navigator & { standalone?: boolean };
    const instalado =
      window.matchMedia("(display-mode: standalone)").matches || navegadorComPadraoIOS.standalone === true;

    setInfo({
      sistemaOperacional: detectarSistemaOperacional(navigator.userAgent),
      instalado,
      podeInstalarNativo: "onbeforeinstallprompt" in window,
    });
  }, []);

  return info;
}