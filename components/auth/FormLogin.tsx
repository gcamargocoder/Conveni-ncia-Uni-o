"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { loginAction } from "@/lib/auth/sessao-actions";
import { gravarMarcador, apagarMarcador, CHAVE_LOGOUT_PENDENTE } from "@/lib/auth/sessao-offline";
import { limparCachesDoServiceWorker } from "@/lib/auth/limpar-caches";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CampoSenha } from "./CampoSenha";

export function FormLogin({ destino }: { destino?: string }) {
  const [emailEstado, setEmail] = useState("");
  const [senhaEstado, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);

    // Lê do formulário (e não só do estado): gerenciadores de senha e
    // preenchimento automático podem alterar o campo sem disparar onChange.
    const dados = new FormData(evento.currentTarget as HTMLFormElement);
    const email = String(dados.get("email") ?? emailEstado);
    const senha = String(dados.get("senha") ?? senhaEstado);

    if (!email.trim() || !senha) {
      setErro("Informe o e-mail e a senha.");
      return;
    }

    setEnviando(true);
    try {
      const resultado = await loginAction({ email, senha, next: destino });
      if (!resultado.sucesso) {
        setErro(resultado.erro ?? "Não foi possível entrar.");
        setSenha("");
        return;
      }

      try {
        localStorage.removeItem(CHAVE_LOGOUT_PENDENTE);
        if (resultado.sessao) {
          gravarMarcador(localStorage, {
            usuarioId: resultado.sessao.usuario.id,
            nome: resultado.sessao.usuario.nome,
            papel: resultado.sessao.usuario.papel === "admin" ? "admin" : "operador",
            ultimaValidacaoEm: Date.now(),
            expiraAbsolutaEm: new Date(resultado.sessao.expiraAbsolutaEm).getTime(),
          });
        } else {
          apagarMarcador(localStorage);
        }
      } catch {
        // sem localStorage: o acesso offline ficará bloqueado, o login online segue normal
      }

      await limparCachesDoServiceWorker();

      // Navegação completa (não SPA): garante que o layout, a sincronização
      // inicial e o worker subam já com a sessão nova.
      window.location.assign(resultado.destino ?? "/");
    } catch {
      setErro("Sem conexão com o servidor. Verifique a internet e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form method="post" onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      {erro && (
        <Alert variante="danger" aria-live="assertive">
          {erro}
        </Alert>
      )}

      <Input
        rotulo="E-mail"
        type="email"
        name="email"
        autoComplete="username"
        inputMode="email"
        autoFocus
        value={emailEstado}
        onChange={(e) => setEmail(e.target.value)}
        maxLength={254}
        autoCapitalize="none"
        required
      />

      <CampoSenha
        rotulo="Senha"
        name="senha"
        autoComplete="current-password"
        value={senhaEstado}
        onChange={(e) => setSenha(e.target.value)}
        maxLength={128}
        required
      />

      <div className="flex justify-end -mt-2">
        <Link href="/recuperar-senha" className="text-sm font-medium text-brand-700 hover:text-brand-900">
          Esqueci minha senha
        </Link>
      </div>

      <Button type="submit" carregando={enviando} larguraTotal>
        Entrar
      </Button>
    </form>
  );
}
