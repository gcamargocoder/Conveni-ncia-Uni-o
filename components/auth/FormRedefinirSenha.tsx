"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { redefinirSenhaAction } from "@/lib/auth/sessao-actions";
import { validarPoliticaSenha, SENHA_TAMANHO_MINIMO } from "@/lib/auth/politica-senha";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CampoSenha } from "./CampoSenha";

export function FormRedefinirSenha({ token }: { token: string }) {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const erroSenha = senha ? validarPoliticaSenha(senha)[0] : undefined;
  const erroConfirmacao = confirmacao && confirmacao !== senha ? "As senhas não coincidem." : undefined;

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);

    if (erroSenha || erroConfirmacao || !senha || !confirmacao) {
      setErro(erroSenha ?? erroConfirmacao ?? "Preencha a nova senha e a confirmação.");
      return;
    }

    setEnviando(true);
    try {
      const resultado = await redefinirSenhaAction({ token, senha, confirmacao });
      if (resultado.sucesso) setConcluido(true);
      else setErro(resultado.erro ?? "Não foi possível redefinir a senha.");
    } catch {
      setErro("Sem conexão com o servidor. Verifique a internet e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  if (concluido) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variante="success">Senha redefinida. Por segurança, todas as sessões anteriores foram encerradas.</Alert>
        <Link
          href="/login"
          className="inline-flex items-center justify-center h-11 rounded-lg bg-brand-700 text-white font-semibold hover:bg-brand-900"
        >
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      {erro && <Alert variante="danger">{erro}</Alert>}

      <CampoSenha
        rotulo="Nova senha"
        autoComplete="new-password"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        maxLength={128}
        erro={erroSenha}
        dica={`Mínimo de ${SENHA_TAMANHO_MINIMO} caracteres, com letras e números.`}
        autoFocus
      />

      <CampoSenha
        rotulo="Confirmar nova senha"
        autoComplete="new-password"
        value={confirmacao}
        onChange={(e) => setConfirmacao(e.target.value)}
        maxLength={128}
        erro={erroConfirmacao}
      />

      <Button type="submit" carregando={enviando} larguraTotal>
        Redefinir senha
      </Button>
    </form>
  );
}
