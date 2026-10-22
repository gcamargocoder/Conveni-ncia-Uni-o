"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { configurarProprietarioInicialAction } from "@/lib/auth/funcionarios-actions";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/ToastProvider";

const somenteDigitos = (v: string) => v.replace(/\D/g, "").slice(0, 4);

/**
 * Configuração inicial do PIN do proprietário. Só é renderizado (pela página) para o administrador
 * do login, enquanto não existe proprietário; o servidor repete essas checagens a cada chamada.
 */
export function ConfigurarProprietarioForm() {
  const [nome, setNome] = useState("");
  const [pin, setPin] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const { mostrar } = useToast();
  const router = useRouter();

  const pinsConferem = pin.length === 4 && pin === confirmacao;

  async function salvar() {
    setSalvando(true);
    setErro(null);
    const resultado = await configurarProprietarioInicialAction({ nome, pin, confirmacaoPin: confirmacao });
    setSalvando(false);
    if (!resultado.sucesso) {
      setErro(resultado.erro ?? "Erro ao configurar o proprietário.");
      return;
    }
    setPin("");
    setConfirmacao("");
    mostrar("success", "Proprietário configurado. Já é possível cadastrar os demais funcionários.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 max-w-md">
      <Alert variante="info" titulo="Configuração inicial">
        Ainda não há proprietário cadastrado. Defina o nome e o PIN de 4 dígitos do proprietário — ele será o
        PIN de autorização para cadastrar funcionários e alterar o estoque. Esta etapa só aparece uma vez.
      </Alert>
      <Input rotulo="Nome do proprietário" value={nome} onChange={(e) => setNome(e.target.value)} />
      <Input
        rotulo="PIN de 4 dígitos"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(somenteDigitos(e.target.value))}
      />
      <Input
        rotulo="Confirme o PIN"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        value={confirmacao}
        onChange={(e) => setConfirmacao(somenteDigitos(e.target.value))}
        erro={confirmacao.length === 4 && !pinsConferem ? "Os PINs não conferem." : undefined}
      />
      {erro && <Alert variante="danger">{erro}</Alert>}
      <Button onClick={salvar} carregando={salvando} disabled={salvando || nome.trim().length < 2 || !pinsConferem}>
        <KeyRound className="w-4 h-4" />
        Definir PIN do proprietário
      </Button>
    </div>
  );
}
