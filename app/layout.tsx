import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { IndicadorConexao } from "@/components/offline/IndicadorConexao";
import { SincronizacaoInicial } from "@/components/offline/SincronizacaoInicial";
import { WorkerSincronizacao } from "@/components/offline/WorkerSincronizacao";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { AppShell } from "@/components/layout/AppShell";
import { OperadorProvider } from "@/hooks/useOperadorTurno";
import { AtualizacaoDisponivel } from "@/components/pwa/AtualizacaoDisponivel";
import { InstalarAppBotao } from "@/components/pwa/InstalarAppBotao";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "Conveniência União",
  description:
    "Sistema de gestão de conveniência do Auto Posto União — vendas, estoque e sincronização, com funcionamento offline.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Conveniência União",
    startupImage: [
      {
        url: "/icons/splash-iphone-se.png",
        media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)",
      },
      {
        url: "/icons/splash-iphone-standard.png",
        media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)",
      },
      {
        url: "/icons/splash-iphone-promax.png",
        media: "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)",
      },
      {
        url: "/icons/splash-ipad.png",
        media: "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2)",
      },
    ],
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"],
  },
};

export const viewport: Viewport = {
  themeColor: "#213E8C",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
            <InstalarAppBotao />
            <AtualizacaoDisponivel />
          </ToastProvider>
        </OperadorProvider>
      </body>
    </html>
  );
}