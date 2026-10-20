import { MoldeAutenticacao } from "@/components/auth/MoldeAutenticacao";
import { FormAtivarConta } from "@/components/auth/FormAtivarConta";
import { Alert } from "@/components/ui/Alert";
import { tokenAtivacaoValido } from "@/services/auth/ativacao.service";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ativar conta — Conveniência União", robots: { index: false, follow: false } };

export default async function AtivarContaPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const valido = typeof token === "string" && (await tokenAtivacaoValido(token));

  if (!valido) {
    return (
      <MoldeAutenticacao titulo="Link inválido">
        <Alert variante="warning">Este link de ativação é inválido, já foi usado, expirou ou a configuração inicial foi encerrada.</Alert>
      </MoldeAutenticacao>
    );
  }

  return (
    <MoldeAutenticacao titulo="Confirmar ativação" subtitulo="Confirme para ativar a conta principal do sistema">
      <FormAtivarConta token={token} />
    </MoldeAutenticacao>
  );
}
