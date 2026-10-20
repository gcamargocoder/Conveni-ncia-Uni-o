"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { solicitarRecuperacaoAction } from "@/lib/auth/sessao-actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

export function FormRecuperarSenha() {
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);
    const dados = new FormData(evento.currentTarget as HTMLFormElement);
    const emailDigitado = String(dados.get("email") ?? email);
    setEnviando(true);
    try {
      const resultado = await solicitarRecuperacaoAction({ email: emailDigitado });
      if (resultado.sucesso) setMensagem(resultado.mensagem);
      else setErro(resultado.erro ?? "Não foi possível enviar o pedido.");
    } catch {
      setErro("Sem conexão com o servidor. Verifique a internet e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  if (mensagem) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variante="success">{mensagem}</Alert>
        <p className="text-sm text-slate-500">
          O link vale por 30 minutos e só pode ser usado uma vez. Confira também a caixa de spam.
        </p>
        <Link href="/login" className="text-sm font-medium text-brand-700 hover:text-brand-900 text-center">
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      {erro && <Alert variante="danger">{erro}</Alert>}

      <Input
        rotulo="E-mail cadastrado"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        maxLength={254}
        required
      />

      <Button type="submit" carregando={enviando} larguraTotal>
        Enviar link de redefinição
      </Button>

      <Link href="/login" className="text-sm font-medium text-brand-700 hover:text-brand-900 text-center">
        Voltar para o login
      </Link>
    </form>
  );
}
