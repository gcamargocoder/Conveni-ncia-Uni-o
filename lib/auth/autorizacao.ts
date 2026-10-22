import { validarPinAction } from "@/lib/auth/actions";
import { possuiPermissao, type Permissao } from "@/lib/auth/permissoes";
import type { Cargo } from "@/types/funcionario";

export type ResultadoAutorizacao =
  | { ok: true; funcionario: { id: string; nome: string; cargo: Cargo } }
  | { ok: false; erro: string };

export const MENSAGEM_SEM_PERMISSAO = "Seu cargo não tem permissão para esta operação.";

/**
 * Autoriza uma operação sensível pelo PIN de um funcionário cujo cargo tenha a permissão pedida.
 * Reaproveita `validarPinAction` — que exige a sessão de login e aplica o bloqueio por tentativas —
 * e decide pela mesma tabela de permissões (`possuiPermissao`) usada em todo o sistema. O login
 * (e-mail e senha) apenas habilita a tentativa; quem autoriza é o PIN.
 *
 * Deve ser chamada pelas Server Actions DEPOIS de `verificarAcesso()`.
 */
export async function autorizarPorPin(pin: string, permissao: Permissao): Promise<ResultadoAutorizacao> {
  const auth = await validarPinAction(pin);
  if (!auth.sucesso || !auth.funcionario) {
    return { ok: false, erro: auth.erro ?? "PIN inválido." };
  }
  if (!possuiPermissao(auth.funcionario.cargo, permissao)) {
    return { ok: false, erro: MENSAGEM_SEM_PERMISSAO };
  }
  return { ok: true, funcionario: auth.funcionario };
}
