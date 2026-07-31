"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { registrarMovimentacao } from "@/services/estoque.service";
import {
  validarMovimentacao,
  permissaoNecessaria,
  DadosMovimentacao,
} from "@/lib/estoque/movimentacao";
import { validarPinAction } from "@/lib/auth/actions";
import { possuiPermissao } from "@/lib/auth/permissoes";

export interface ResultadoAcaoMovimentacao {
  sucesso: boolean;
  erros?: { campo: string; mensagem: string }[];
  erroGeral?: string;
}

/**
 * Toda movimentação manual exige o PIN de quem está autorizando —
 * mesmo que já exista um "operador de turno" definido, porque um
 * ajuste de estoque pode precisar da autorização do gerente, não
 * do caixa que está logado no momento.
 */
export async function registrarMovimentacaoAction(
  dados: Omit<DadosMovimentacao, "funcionario_id">,
  pin: string
): Promise<ResultadoAcaoMovimentacao> {
  const auth = await validarPinAction(pin);
  if (!auth.sucesso || !auth.funcionario) {
    return { sucesso: false, erroGeral: "PIN inválido." };
  }

  if (!possuiPermissao(auth.funcionario.cargo, permissaoNecessaria(dados.tipo))) {
    return { sucesso: false, erroGeral: "Seu cargo não tem permissão para esta operação." };
  }

  const dispositivo = (await headers()).get("user-agent") ?? undefined;
  const dadosCompletos: DadosMovimentacao = {
    ...dados,
    funcionario_id: auth.funcionario.id,
    dispositivo,
  };
  const erros = validarMovimentacao(dadosCompletos);
  if (erros.length > 0) return { sucesso: false, erros };

  try {
    await registrarMovimentacao(dadosCompletos);
    revalidatePath("/estoque");
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erroGeral: (e as Error).message };
  }
}
