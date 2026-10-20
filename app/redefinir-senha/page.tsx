import Link from "next/link";
import { MoldeAutenticacao } from "@/components/auth/MoldeAutenticacao";
import { FormRedefinirSenha } from "@/components/auth/FormRedefinirSenha";
import { Alert } from "@/components/ui/Alert";
import { tokenRecuperacaoValido } from "@/services/auth/auth.service";

export const dynamic = "force-dynamic";

export const metadata = { title: "Redefinir senha — Conveniência União" };

export default async function RedefinirSenhaPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const valido = typeof token === "string" && (await tokenRecuperacaoValido(token));

  if (!valido) {
    return (
      <MoldeAutenticacao titulo="Link inválido">
        <div className="flex flex-col gap-4">
          <Alert variante="warning">Este link de redefinição é inválido, já foi usado ou expirou.</Alert>
          <Link
            href="/recuperar-senha"
            className="inline-flex items-center justify-center h-11 rounded-lg bg-brand-700 text-white font-semibold hover:bg-brand-900"
          >
            Solicitar novo link
          </Link>
        </div>
      </MoldeAutenticacao>
    );
  }

  return (
    <MoldeAutenticacao titulo="Nova senha" subtitulo="Escolha uma senha forte para a sua conta">
      <FormRedefinirSenha token={token} />
    </MoldeAutenticacao>
  );
}
