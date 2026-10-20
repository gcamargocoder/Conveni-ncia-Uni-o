import { exigirSessao } from "@/lib/auth/servidor";

// A página de sincronização é um Client Component (lê só o IndexedDB), então a
// exigência de sessão no servidor fica neste layout.
export default async function SincronizacaoLayout({ children }: { children: React.ReactNode }) {
  await exigirSessao();
  return <>{children}</>;
}
