import Image from "next/image";
import type { ReactNode } from "react";

/** Moldura das telas públicas de autenticação (login, recuperar e redefinir senha). */
export function MoldeAutenticacao({
  titulo,
  subtitulo,
  children,
  rodape,
}: {
  titulo: string;
  subtitulo?: string;
  children: ReactNode;
  rodape?: ReactNode;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-10">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image
            src="/logo-auto-posto-uniao.jpeg"
            alt="Auto Posto União"
            width={64}
            height={64}
            priority
            className="rounded-xl shadow-card"
          />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{titulo}</h1>
            {subtitulo && <p className="text-slate-500 text-sm mt-1">{subtitulo}</p>}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-elevated p-6">{children}</div>

        {rodape && <div className="text-center text-sm text-slate-500">{rodape}</div>}
      </div>
    </main>
  );
}
