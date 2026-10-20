import { redirect } from "next/navigation";
import { MoldeAutenticacao } from "@/components/auth/MoldeAutenticacao";
import { FormLogin } from "@/components/auth/FormLogin";
import { obterSessaoAtual } from "@/lib/auth/servidor";
import { destinoSeguro } from "@/lib/auth/constantes";

export const dynamic = "force-dynamic";

export const metadata = { title: "Entrar — Conveniência União" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const destino = destinoSeguro(next);

  // Quem já está autenticado não precisa ver o login de novo.
  if (await obterSessaoAtual()) redirect(destino);

  return (
    <MoldeAutenticacao titulo="Entrar" subtitulo="Acesse o sistema da Conveniência União">
      <FormLogin destino={destino} />
    </MoldeAutenticacao>
  );
}
