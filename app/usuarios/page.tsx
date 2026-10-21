import { ShieldCheck } from "lucide-react";
import { exigirAdmin } from "@/lib/auth/servidor";
import { listarUsuarios } from "@/services/usuarios.service";
import { emailConfigurado } from "@/lib/email/enviar";
import { UsuarioAcoes } from "@/components/usuarios/UsuarioAcoes";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Table } from "@/components/ui/Table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Usuários — Conveniência União" };

function formatarData(iso: string | null): string {
  if (!iso) return "Nunca";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default async function UsuariosPage() {
  const sessao = await exigirAdmin();
  const usuarios = await listarUsuarios();

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Usuários</h1>
          <p className="text-slate-500 text-sm">Conta principal de acesso ao sistema (e-mail e senha)</p>
        </div>
      </header>

      <Alert variante="info" titulo="Conta única de acesso">
        O sistema tem uma única conta principal de login. Esta tela não cria contas: funcionários e PINs são geridos em
        Funcionários.
      </Alert>

      {usuarios.length > 1 && (
        <Alert variante="warning" titulo="Há contas de login adicionais">
          Existem {usuarios.length} contas de login, mas a regra é uma só. Nada foi apagado: confira abaixo e desative as
          que não forem a conta principal.
        </Alert>
      )}

      {!emailConfigurado() && (
        <Alert variante="warning" titulo="E-mail não configurado">
          A recuperação de senha e o envio de links de redefinição dependem de RESEND_API_KEY, EMAIL_FROM e APP_URL no
          servidor. Veja AUTENTICACAO.md.
        </Alert>
      )}

      <Card semPadding>
        <div className="flex items-center gap-2 px-5 pt-5 mb-1">
          <ShieldCheck className="w-4 h-4 text-violet-500" />
          <h2 className="text-sm font-semibold text-slate-700">Cadastrados ({usuarios.length})</h2>
        </div>
        <Table
          colunas={[
            {
              chave: "nome",
              cabecalho: "Usuário",
              render: (u) => (
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 truncate">{u.nome}</p>
                  <p className="text-xs text-slate-500 truncate">{u.email}</p>
                </div>
              ),
            },
            {
              chave: "papel",
              cabecalho: "Papel",
              render: (u) => (
                <Badge variante={u.papel === "admin" ? "brand" : "neutral"}>
                  {u.papel === "admin" ? "Administrador" : "Operador"}
                </Badge>
              ),
            },
            {
              chave: "situacao",
              cabecalho: "Situação",
              render: (u) => <Badge variante={u.ativo ? "success" : "danger"}>{u.ativo ? "Ativo" : "Desativado"}</Badge>,
            },
            { chave: "ultimo_login_em", cabecalho: "Último acesso", render: (u) => formatarData(u.ultimo_login_em) },
            {
              chave: "acoes",
              cabecalho: "",
              render: (u) => <UsuarioAcoes usuario={u} souEu={u.id === sessao.usuario.id} />,
            },
          ]}
          dados={usuarios}
          chaveLinha={(u) => u.id}
          vazioIcone={ShieldCheck}
          vazioModulo="usuarios"
          vazioTitulo="Nenhum usuário cadastrado"
          vazioDescricao="Crie a conta principal com npm run admin:criar (ver AUTENTICACAO.md)."
        />
      </Card>
    </main>
  );
}
