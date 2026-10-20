"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { confirmarAtivacaoAction } from "@/lib/auth/ativacao-actions";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

/** A ativação só acontece no clique (POST): abrir o link, por si só, não consome o token. */
export function FormAtivarConta({ token }: { token: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function confirmar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const r = await confirmarAtivacaoAction(token);
      if (r.sucesso) setConcluido(true);
      else setErro(r.erro ?? "Não foi possível ativar a conta.");
    } catch {
      setErro("Sem conexão com o servidor. Verifique a internet e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  if (concluido) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variante="success">Conta principal ativada. Entre com o e-mail e a senha que você definiu.</Alert>
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
    <form method="post" onSubmit={confirmar} className="flex flex-col gap-4">
      {erro && <Alert variante="danger">{erro}</Alert>}
      <Button type="submit" carregando={enviando} larguraTotal>
        Ativar conta principal
      </Button>
    </form>
  );
}
