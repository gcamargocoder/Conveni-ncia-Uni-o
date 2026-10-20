import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, rotaPublica } from "@/lib/auth/constantes";

/**
 * Primeira barreira (roda no Edge, sem acesso ao banco): quem não traz nem o
 * cookie de sessão é mandado para /login antes de qualquer página ser
 * renderizada. É só um filtro barato — a validação REAL da sessão (existe,
 * não expirou, usuário ativo, papel) é feita no servidor, contra o banco, em
 * cada página (`exigirSessao`) e em cada Server Action (`verificarAcesso`).
 *
 * Server Actions (cabeçalho `next-action`) passam sem redirecionamento: elas
 * se protegem sozinhas e respondem com um resultado estruturado, o que
 * mantém intacta a fila de sincronização offline quando a sessão expira.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const cabecalhos = new Headers(request.headers);
  cabecalhos.set("x-pathname", pathname + search);
  // Pedido de "cópia neutra" feito pelo service worker (ver public/sw.js e app/layout.tsx): o layout
  // renderiza sem dados da sessão e a resposta confirma com o mesmo cabeçalho.
  const neutra = request.headers.get("x-pagina-neutra") === "1";
  const seguir = () => {
    const resposta = NextResponse.next({ request: { headers: cabecalhos } });
    if (neutra) resposta.headers.set("x-pagina-neutra", "1");
    return resposta;
  };

  if (rotaPublica(pathname)) return seguir();

  const temCookie = Boolean(request.cookies.get(COOKIE_SESSAO)?.value);
  if (temCookie) return seguir();

  // Só Server Actions de verdade (POST) e nunca em /api: qualquer outra
  // requisição com esse cabeçalho forjado é tratada como acesso comum.
  const ehApi = pathname.startsWith("/api/");
  if (!ehApi && request.method === "POST" && request.headers.has("next-action")) return seguir();

  if (ehApi) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const destino = request.nextUrl.clone();
  destino.pathname = "/login";
  destino.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(destino);
}

export const config = {
  // Tudo, exceto arquivos estáticos do Next e da pasta public (ícones, logos,
  // service worker, manifest). Esses não contêm dados e precisam carregar
  // mesmo antes do login (inclusive a própria tela de login).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|icons/|logos/|logo-auto-posto-uniao.jpeg|offline.html|manifest.webmanifest).*)",
  ],
};
