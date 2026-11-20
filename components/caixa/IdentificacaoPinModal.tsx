"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PinInput } from "@/components/auth/PinInput";
import { validarPinParaOperacao } from "@/services/offline/pin-venda.service";
import type { Permissao } from "@/lib/auth/permissoes";
import type { Responsavel } from "@/services/offline/caixa-local.service";
import { autorizarOperacaoCaixaAction } from "@/lib/caixa/actions";
import type { EscopoAutorizacao } from "@/services/caixa.service";

interface Props {
  aberto: boolean;
  titulo: string;
  descricao: string;
  /** Permissão exigida do funcionário identificado pelo PIN (decidida pela mesma tabela do restante do sistema). */
  permissao: Permissao;
  onFechar: () => void;
  /**
   * Operações administrativas (sangria, suprimento, despesa, ajuste, estorno): o servidor valida o PIN de novo e
   * registra uma autorização presa a esta operação e aos seus valores. Sem ela o servidor NÃO aplica a operação
   * na sincronização — o id do funcionário guardado no aparelho não basta.
   */
  escopo?: EscopoAutorizacao;
  /** Executa a operação com o funcionário identificado. Lançar erro mantém o modal aberto exibindo a mensagem. */
  onConfirmar: (responsavel: Responsavel) => Promise<void>;
}

/**
 * Identificação do funcionário pelo PIN individual — o MESMO mecanismo do PDV (validarPinParaOperacao):
 * online o servidor valida o PIN, o cargo e o bloqueio por tentativas; offline vale o PIN local, só para
 * cargos que apenas vendem. O PIN é pedido a CADA operação e nunca é guardado nem enviado depois.
 */
export function IdentificacaoPinModal({ aberto, titulo, descricao, permissao, escopo, onFechar, onConfirmar }: Props) {
  // Enquanto o PIN é validado/autorizado no servidor, Esc, o fundo e o "Fechar" ficam bloqueados: fechar agora
  // esconderia o resultado (sucesso ou erro) de uma operação em andamento.
  const [ocupado, setOcupado] = useState(false);

  async function aoCompletar(pin: string) {
    setOcupado(true);
    try {
      const auth = await validarPinParaOperacao(pin, permissao);
      if (!auth.sucesso || !auth.funcionario) throw new Error(auth.erro ?? "PIN não confirmado. A operação NÃO foi registrada.");
      if (escopo) {
        // Sem resposta confirmada do servidor NADA é registrado nem anunciado como feito: o erro mantém o modal
        // aberto. O id da operação é o mesmo na nova tentativa, então repetir não duplica.
        const servidor = await autorizarOperacaoCaixaAction(escopo, pin).catch(() => null);
        if (!servidor) {
          throw new Error("Falha de comunicação: o servidor não confirmou a autorização e a operação NÃO foi registrada. Verifique a conexão e tente novamente.");
        }
        if (!servidor.sucesso) {
          throw new Error(servidor.erroAutorizacao ?? servidor.erro ?? "O servidor não confirmou a autorização. A operação NÃO foi registrada.");
        }
        if (servidor.funcionario?.id !== auth.funcionario.id) {
          throw new Error("O servidor identificou outro funcionário para este PIN. A operação NÃO foi registrada.");
        }
      }
      await onConfirmar({ id: auth.funcionario.id, nome: auth.funcionario.nome });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo={titulo} onFechar={onFechar} bloqueado={ocupado}>
      <p className="mb-4">{descricao}</p>
      <PinInput modo="confirmacao" onPinCompleto={aoCompletar} onSucesso={onFechar} />
    </Modal>
  );
}
