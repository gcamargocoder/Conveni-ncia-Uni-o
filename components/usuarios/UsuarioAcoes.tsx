"use client";

import { useState } from "react";
import { KeyRound, ShieldCheck, ShieldOff, UserCheck, UserX } from "lucide-react";
import {
  alterarAtivoUsuarioAction,
  alterarPapelUsuarioAction,
  redefinirAcessoUsuarioAction,
  ResultadoAcaoUsuario,
} from "@/lib/usuarios/actions";
import type { UsuarioListado } from "@/services/usuarios.service";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";

export function UsuarioAcoes({ usuario, souEu }: { usuario: UsuarioListado; souEu: boolean }) {
  const [ocupado, setOcupado] = useState(false);
  const { mostrar } = useToast();

  async function executar(
    acao: () => Promise<ResultadoAcaoUsuario>,
    mensagemSucesso: string,
    confirmacao?: string
  ) {
    if (ocupado) return;
    if (confirmacao && !window.confirm(confirmacao)) return;
    setOcupado(true);
    try {
      const resultado = await acao();
      if (resultado.sucesso) mostrar("success", resultado.aviso ?? mensagemSucesso);
      else mostrar("danger", resultado.erro ?? "Operação não concluída.");
    } catch {
      mostrar("danger", "Sem conexão com o servidor.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5 justify-end">
      {usuario.ativo && (
        <Button
          tamanho="sm"
          variante="secondary"
          disabled={ocupado}
          title="Encerra as sessões e envia um link de nova senha por e-mail"
          onClick={() =>
            executar(
              () => redefinirAcessoUsuarioAction(usuario.id),
              "Acesso redefinido.",
              `Encerrar as sessões de ${usuario.nome} e enviar um link de nova senha para ${usuario.email}?`
            )
          }
        >
          <KeyRound className="w-4 h-4 text-violet-500" />
          Redefinir acesso
        </Button>
      )}

      {usuario.papel === "operador" ? (
        <Button
          tamanho="sm"
          variante="ghost"
          disabled={ocupado || !usuario.ativo}
          onClick={() =>
            executar(
              () => alterarPapelUsuarioAction(usuario.id, "admin"),
              "Agora é administrador.",
              `Tornar ${usuario.nome} administrador? Administradores gerenciam usuários e backups.`
            )
          }
        >
          <ShieldCheck className="w-4 h-4 text-violet-500" />
          Tornar admin
        </Button>
      ) : (
        <Button
          tamanho="sm"
          variante="ghost"
          disabled={ocupado}
          onClick={() => executar(() => alterarPapelUsuarioAction(usuario.id, "operador"), "Agora é operador.")}
        >
          <ShieldOff className="w-4 h-4 text-violet-500" />
          Tornar operador
        </Button>
      )}

      {usuario.ativo ? (
        <Button
          tamanho="sm"
          variante="danger"
          disabled={ocupado || souEu}
          title={souEu ? "Você não pode desativar o próprio acesso" : undefined}
          onClick={() =>
            executar(
              () => alterarAtivoUsuarioAction(usuario.id, false),
              "Usuário desativado.",
              `Desativar ${usuario.nome}? As sessões abertas serão encerradas imediatamente.`
            )
          }
        >
          <UserX className="w-4 h-4" />
          Desativar
        </Button>
      ) : (
        <Button
          tamanho="sm"
          variante="secondary"
          disabled={ocupado}
          onClick={() => executar(() => alterarAtivoUsuarioAction(usuario.id, true), "Usuário reativado.")}
        >
          <UserCheck className="w-4 h-4 text-emerald-500" />
          Reativar
        </Button>
      )}
    </div>
  );
}
