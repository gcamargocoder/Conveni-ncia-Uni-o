"use client";

import { FormEvent, useState } from "react";
import { solicitarAtivacaoAction } from "@/lib/auth/ativacao-actions";
import { validarPoliticaSenha, SENHA_TAMANHO_MINIMO } from "@/lib/auth/politica-senha";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CampoSenha } from "./CampoSenha";

export function FormConfigurarConta() {
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const erroSenha = senha ? validarPoliticaSenha(senha, email)[0] : undefined;
  const erroConfirmacao = confirmacao && confirmacao !== senha ? "As senhas não coincidem." : undefined;

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setErro(null);

    if (!codigo || !nome.trim() || !email.trim() || !senha || !confirmacao || erroSenha || erroConfirmacao) {
      setErro(erroSenha ?? erroConfirmacao ?? "Preencha todos os campos.");
      return;
    }

    setEnviando(true);
    try {
      const r = await solicitarAtivacaoAction({ codigo, nome, email, senha, confirmacao });
      if (r.sucesso) {
        setSenha("");
        setConfirmacao("");
        setCodigo("");
        setEnviado(true);
      } else {
        setErro(r.erro ?? "Não foi possível iniciar a ativação.");
      }
    } catch {
      setErro("Sem conexão com o servidor. Verifique a internet e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <Alert variante="success" titulo="Confirme pelo e-mail">
        Enviamos um link de confirmação para {email}. A conta só será ativada depois que você abrir o link e confirmar
        (válido por 30 minutos, uso único).
      </Alert>
    );
  }

  return (
    <form method="post" onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      {erro && <Alert variante="danger">{erro}</Alert>}

      <CampoSenha
        rotulo="Código de inicialização"
        autoComplete="off"
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
        maxLength={512}
        dica="Fornecido por quem configurou o servidor."
        autoFocus
      />
      <Input rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} autoComplete="name" />
      <Input
        rotulo="E-mail"
        type="email"
        inputMode="email"
        autoCapitalize="none"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        maxLength={254}
      />
      <CampoSenha
        rotulo="Senha"
        autoComplete="new-password"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        maxLength={128}
        erro={erroSenha}
        dica={`Mínimo de ${SENHA_TAMANHO_MINIMO} caracteres, com letras e números.`}
      />
      <CampoSenha
        rotulo="Confirmar senha"
        autoComplete="new-password"
        value={confirmacao}
        onChange={(e) => setConfirmacao(e.target.value)}
        maxLength={128}
        erro={erroConfirmacao}
      />

      <Button type="submit" carregando={enviando} larguraTotal>
        Enviar link de confirmação
      </Button>
    </form>
  );
}
