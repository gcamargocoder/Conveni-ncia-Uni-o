"use server";

import { verificarAcesso } from "@/lib/auth/servidor";
import { processarVendaRecebida } from "@/services/vendas-sincronizadas.service";
import { FormaPagamento } from "@/types/venda";
import type { PagamentoVenda } from "@/lib/caixa/validacao";

export interface PayloadVendaFila {
  funcionario_id: string;
  forma_pagamento: FormaPagamento | "misto";
  total: number;
  /** Caixa (terminal) da venda e o detalhe de cada forma de pagamento (pagamento dividido). */
  caixa_id?: string | null;
  pagamentos?: PagamentoVenda[];
  criado_em?: string;
  origem?: "online" | "offline";
  dispositivo?: string;
  terminal?: string;
  itens: { produto_id: string; quantidade: number; preco_unitario: number }[];
  cliente_id?: string | null;
}

/**
 * Destino da venda quando o servidor NÃO a gravou automaticamente:
 *  - "em_revisao": retida no servidor com os motivos; um administrador decide;
 *  - "rejeitada": um administrador já a rejeitou;
 *  - "invalida": o envio não pôde nem ser retido (identificador/conteúdo inutilizável).
 * Em nenhum caso a venda é apagada — ela continua no aparelho, marcada e visível.
 */
export type DestinoRetido = "em_revisao" | "rejeitada" | "invalida";

export interface ResultadoSincronizarVenda {
  sucesso: boolean;
  jaExistia?: boolean;
  erro?: string;
  /** A sessão do usuário expirou: a venda continua na fila local e será reenviada após novo login. */
  requerLogin?: boolean;
  retida?: DestinoRetido;
  /** O caixa da venda ainda não foi sincronizado: a venda segue pendente e é reenviada depois (sem contar falha). */
  aguardandoCaixa?: boolean;
  /** Motivos legíveis, quando retida. */
  motivos?: string[];
}

export async function sincronizarVendaAction(
  id: string,
  payload: PayloadVendaFila
): Promise<ResultadoSincronizarVenda> {
  const acesso = await verificarAcesso();
  if (!acesso.ok) return { sucesso: false, erro: acesso.erro, requerLogin: true };

  try {
    const resultado = await processarVendaRecebida(id, payload, acesso.sessao.usuario.id);

    switch (resultado.status) {
      case "registrada":
        return { sucesso: true, jaExistia: resultado.jaExistia };
      case "em_revisao":
        return {
          sucesso: false,
          retida: "em_revisao",
          motivos: resultado.motivos.map((m) => m.mensagem),
          erro: "Venda retida para revisão do administrador.",
        };
      case "rejeitada":
        return { sucesso: false, retida: "rejeitada", erro: resultado.observacao ?? "Venda rejeitada por um administrador." };
      case "aguardando_caixa":
        return { sucesso: false, aguardandoCaixa: true, erro: "Aguardando a sincronização do caixa desta venda." };
      case "invalida":
        return {
          sucesso: false,
          retida: "invalida",
          motivos: resultado.motivos.map((m) => m.mensagem),
          erro: "Venda inválida: não pôde ser enviada.",
        };
    }
  } catch (e) {
    return { sucesso: false, erro: (e as Error).message };
  }
}
