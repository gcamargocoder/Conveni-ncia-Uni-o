import { MoldeAutenticacao } from "@/components/auth/MoldeAutenticacao";
import { FormRecuperarSenha } from "@/components/auth/FormRecuperarSenha";

export const metadata = { title: "Recuperar senha — Conveniência União" };

export default function RecuperarSenhaPage() {
  return (
    <MoldeAutenticacao
      titulo="Recuperar senha"
      subtitulo="Informe o e-mail da sua conta para receber o link de redefinição"
    >
      <FormRecuperarSenha />
    </MoldeAutenticacao>
  );
}
