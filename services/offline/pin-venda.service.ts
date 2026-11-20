import { validarPinAction, ResultadoAutenticacao } from "@/lib/auth/actions";
import { possuiPermissao, type Permissao } from "@/lib/auth/permissoes";
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
  return validarPinParaOperacao(pin, "pdv.vender");
}

/**
 * Mesmo mecanismo de PIN do PDV, para qualquer operação do caixa: identifica o FUNCIONÁRIO (não o login)
 * e confere se o cargo tem a permissão pedida. Offline só funcionam as permissões que o cargo
 * "somente vende" tem (abrir, vender, fechar); sangria, suprimento, despesa e estorno exigem o PIN de
 * proprietário/gerente, que nunca sai do servidor — logo exigem conexão.
 */
export const MSG_EXIGE_CONEXAO =
  "Esta operação exige conexão com o servidor para validar o PIN de proprietário ou gerente. Conecte-se e tente novamente.";
export const MSG_FALHA_COMUNICACAO =
  "Falha de comunicação com o servidor: o PIN não foi confirmado e nada foi registrado. Tente novamente.";
export const MSG_SESSAO_EXPIRADA = "Sessão expirada: entre novamente no sistema (online) para autorizar esta operação.";

export async function validarPinParaOperacao(pin: string, permissao: Permissao): Promise<ResultadoValidacaoPinLocal> {
  const semPermissao = permissao === "pdv.vender" ? "Seu cargo não tem permissão para vender." : "Seu cargo não tem permissão para esta operação.";
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  // Só o servidor conhece o PIN de quem pode mais do que vender: para essas operações não existe "reserva offline".
  const exigeServidor = permissao !== "pdv.vender";

  if (exigeServidor && !online) return { sucesso: false, erro: MSG_EXIGE_CONEXAO };

  if (online) {
    try {
      const servidor = await Promise.race<ResultadoAutenticacao | "tempo">([
        validarPinAction(pin),
        new Promise<"tempo">((resolver) => setTimeout(() => resolver("tempo"), TEMPO_LIMITE_SERVIDOR_MS)),
      ]);

      if (servidor !== "tempo") {
        if (servidor.sucesso && servidor.funcionario) {
          return possuiPermissao(servidor.funcionario.cargo, permissao)
            ? { sucesso: true, funcionario: servidor.funcionario }
            : { sucesso: false, erro: semPermissao };
        }
        if (servidor.motivo === "pin_incorreto" || servidor.motivo === "bloqueado") {
          return { sucesso: false, erro: servidor.erro };
        }
        if (exigeServidor) return { sucesso: false, erro: servidor.motivo === "sem_sessao" ? MSG_SESSAO_EXPIRADA : MSG_FALHA_COMUNICACAO };
        // sem_sessao ou resposta inesperada: tenta o PIN offline
      } else if (exigeServidor) {
        return { sucesso: false, erro: MSG_FALHA_COMUNICACAO };
      }
    } catch {
      // rede caiu no meio da chamada: tenta o PIN offline (só para quem apenas vende)
      if (exigeServidor) return { sucesso: false, erro: MSG_FALHA_COMUNICACAO };
    }
  }

  const local = await validarPinLocalmente(pin);
  if (!local.sucesso && local.erro === "PIN incorreto.") {
    return {
      sucesso: false,
      // Offline não dá para saber se o PIN está errado ou é de proprietário/gerente (que só o servidor conhece).
      erro: online ? "PIN incorreto." : "PIN não reconhecido neste aparelho sem conexão. Confira o PIN; se for de proprietário ou gerente, a validação exige conexão com o servidor.",
    };
  }
  if (local.sucesso && local.funcionario && !possuiPermissao(local.funcionario.cargo, permissao)) {
    return { sucesso: false, erro: semPermissao };
  }
  return local;
}
