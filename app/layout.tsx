import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { IndicadorConexao } from "@/components/offline/IndicadorConexao";
import { SincronizacaoInicial } from "@/components/offline/SincronizacaoInicial";
import { WorkerSincronizacao } from "@/components/offline/WorkerSincronizacao";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { AppShell } from "@/components/layout/AppShell";
import { OperadorProvider } from "@/hooks/useOperadorTurno";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "Auto Posto União — Conveniência",
  description: "Gestão de conveniência do Auto Posto União",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={manrope.variable} suppressHydrationWarning>
      <body className="bg-slate-50 text-slate-900 font-sans" suppressHydrationWarning>
        <OperadorProvider>
          <ToastProvider>
            <SincronizacaoInicial />
            <WorkerSincronizacao />
            <IndicadorConexao />
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </OperadorProvider>
      </body>
    </html>
  );
}