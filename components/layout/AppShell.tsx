"use client";

import { useState, useEffect } from "react";
import { Menu } from "lucide-react";
import Image from "next/image";
import { Sidebar } from "./Sidebar";

const CHAVE_COLAPSADA = "sidebar-colapsada";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [colapsada, setColapsada] = useState(false);
  const [abertaMobile, setAbertaMobile] = useState(false);

  useEffect(() => {
    const salvo = localStorage.getItem(CHAVE_COLAPSADA);
    if (salvo === "true") setColapsada(true);
  }, []);

  function alternarColapsar() {
    setColapsada((atual) => {
      localStorage.setItem(CHAVE_COLAPSADA, String(!atual));
      return !atual;
    });
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        colapsada={colapsada}
        onToggleColapsar={alternarColapsar}
        abertaMobile={abertaMobile}
        onFecharMobile={() => setAbertaMobile(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="md:hidden flex items-center gap-3 h-14 px-4 border-b border-slate-200 bg-white shrink-0">
          <button onClick={() => setAbertaMobile(true)} aria-label="Abrir menu">
            <Menu className="w-5 h-5 text-slate-600" />
          </button>
          <Image
            src="/logo-auto-posto-uniao.jpeg"
            alt="Auto Posto União"
            width={24}
            height={24}
            className="rounded"
          />
          <span className="font-semibold text-sm text-slate-900">Auto Posto União</span>
        </div>

        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}