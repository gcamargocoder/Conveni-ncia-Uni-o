import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { IndicadorConexao } from "@/components/offline/IndicadorConexao";
import { SincronizacaoInicial } from "@/components/offline/SincronizacaoInicial";
import { WorkerSincronizacao } from "@/components/offline/WorkerSincronizacao";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { AppShell } from "@/components/layout/AppShell";
import { OperadorProvider } from "@/hooks/useOperadorTurno";
import { AtualizacaoDisponivel } from "@/components/pwa/AtualizacaoDisponivel";
import { InstalarAppBotao } from "@/components/pwa/InstalarAppBotao";
import { SessaoProvider } from "@/components/auth/SessaoProvider";
import { GuardaSessao } from "@/components/auth/GuardaSessao";
import { obterSessaoAtual } from "@/lib/auth/servidor";
import { rotaPublica } from "@/lib/auth/constantes";
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sessao = await obterSessaoAtual();
  const cabecalhos = await headers();
  const caminho = cabecalhos.get("x-pathname") ?? "/";
  // Cópia "neutra" (pedida só pelo service worker para guardar no cache offline): o HTML não leva
  // nenhum dado da pessoa logada (nome, e-mail, papel, id, validade da sessão). A interface os obtém
  // no aparelho (SessaoProvider) a partir do marcador local, que o logout apaga.
  const neutra = cabecalhos.get("x-pagina-neutra") === "1";

  // Rede de segurança para qualquer rota, inclusive páginas só de cliente:
  // fora das rotas públicas, sem sessão válida não renderiza nada.
  if (!sessao && !rotaPublica(caminho.split("?")[0])) {
    redirect(`/login?next=${encodeURIComponent(caminho)}`);
  }

  return (
    <html lang="pt-BR" className={manrope.variable} suppressHydrationWarning>
      <body className="bg-slate-50 text-slate-900 font-sans" suppressHydrationWarning>
        <SessaoProvider
          neutro={neutra}
          usuario={sessao && !neutra ? { id: sessao.usuario.id, nome: sessao.usuario.nome, email: sessao.usuario.email, papel: sessao.usuario.papel } : null}
          expiraAbsolutaEm={sessao && !neutra ? sessao.expiraAbsolutaEm.toISOString() : null}
        >
          <OperadorProvider>
            <ToastProvider>
              {sessao && (
                <>
                  <SincronizacaoInicial />
                  <WorkerSincronizacao />
                </>
              )}
              <IndicadorConexao />
              {sessao ? (
                <GuardaSessao>
                  <AppShell>{children}</AppShell>
                </GuardaSessao>
              ) : (
                <AppShell comMenu={false}>{children}</AppShell>
              )}
              <InstalarAppBotao />
              <AtualizacaoDisponivel />
            </ToastProvider>
          </OperadorProvider>
        </SessaoProvider>
      </body>
    </html>
  );
}