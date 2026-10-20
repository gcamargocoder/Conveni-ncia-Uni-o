import { validarPinAction, ResultadoAutenticacao } from "@/lib/auth/actions";
import { possuiPermissao } from "@/lib/auth/permissoes";
import { validarPinLocalmente, ResultadoValidacaoPinLocal } from "./pin-local.service";

const TEMPO_LIMITE_SERVIDOR_MS = 4000;

/**
 * Identifica o funcionário de uma venda pelo PIN.
 *
 *  1. COM conexão e sessão: o servidor valida (única validação com segurança de verdade:
 *     contador de tentativas no servidor, hash que nunca sai dele). PIN errado ou bloqueio
 *     do servidor são respostas DEFINITIVAS — não há "tentar de novo offline".
 *  2. Sem conexão, sem sessão, erro ou demora (> 4 s): cai no PIN offline, que só conhece os
 *     cargos que apenas vendem. Gerente/proprietário precisam de conexão para vender.
 *
 * O servidor NÃO tem como provar, depois, qual PIN foi digitado numa venda offline: ele
 * apenas confere que o funcionário existe, está ativo e pode vender (ver
 * vendas-sincronizadas.service.ts) e registra também o usuário logado.
 */
export async function validarPinParaVenda(pin: string): Promise<ResultadoValidacaoPinLocal> {
  const online = typeof navigator === "undefined" ? true : navigator.onLine;

  if (online) {
    try {
      const servidor = await Promise.race<ResultadoAutenticacao | "tempo">([
        validarPinAction(pin),
        new Promise<"tempo">((resolver) => setTimeout(() => resolver("tempo"), TEMPO_LIMITE_SERVIDOR_MS)),
      ]);

      if (servidor !== "tempo") {
        if (servidor.sucesso && servidor.funcionario) {
          return possuiPermissao(servidor.funcionario.cargo, "pdv.vender")
            ? { sucesso: true, funcionario: servidor.funcionario }
            : { sucesso: false, erro: "Seu cargo não tem permissão para vender." };
        }
        if (servidor.motivo === "pin_incorreto" || servidor.motivo === "bloqueado") {
          return { sucesso: false, erro: servidor.erro };
        }
        // sem_sessao ou resposta inesperada: tenta o PIN offline
      }
    } catch {
      // rede caiu no meio da chamada: tenta o PIN offline
    }
  }

  const local = await validarPinLocalmente(pin);
  if (!local.sucesso && local.erro === "PIN incorreto.") {
    return {
      sucesso: false,
      erro: online ? "PIN incorreto." : "PIN incorreto, ou o cargo exige conexão com o servidor.",
    };
  }
  return local;
}
