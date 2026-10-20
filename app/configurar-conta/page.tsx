import { MoldeAutenticacao } from "@/components/auth/MoldeAutenticacao";
import { FormConfigurarConta } from "@/components/auth/FormConfigurarConta";
import { Alert } from "@/components/ui/Alert";
import { situacaoAtivacao } from "@/services/auth/ativacao.service";

export const dynamic = "force-dynamic";

export const metadata = { title: "Configuração inicial — Conveniência União", robots: { index: false, follow: false } };

export default async function ConfigurarContaPage() {
  const situacao = await situacaoAtivacao();

  // Fechada ou desligada: mensagem única, sem revelar qual das duas e sem formulário.
  if (situacao === "encerrada" || situacao === "desligada") {
    return (
      <MoldeAutenticacao titulo="Configuração inicial">
        <Alert variante="warning">A configuração inicial não está disponível.</Alert>
      </MoldeAutenticacao>
    );
  }

  return (
    <MoldeAutenticacao titulo="Configuração inicial" subtitulo="Ative a conta principal do sistema">
      {situacao === "email_nao_configurado" ? (
        <Alert variante="warning" titulo="E-mail não configurado">
          O envio de e-mail (RESEND_API_KEY, EMAIL_FROM, APP_URL) não está configurado no servidor. A conta não pode ser
          ativada até isso ser resolvido.
        </Alert>
      ) : (
        <FormConfigurarConta />
      )}
    </MoldeAutenticacao>
  );
}
