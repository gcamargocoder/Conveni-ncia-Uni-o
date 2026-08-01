import { getOfflineDB } from "./db";
import { verificarPin } from "@/lib/auth/pin";
import { obterConfiguracao, definirConfiguracao } from "./configuracao-local.service";
import { estaBloqueado, deveBloquear, calcularBloqueioAte, EstadoTentativas } from "@/lib/auth/protecao-forca-bruta";
import type { Cargo } from "@/types/funcionario";

const CHAVE_TENTATIVAS = "tentativas_pin_local";

export interface ResultadoValidacaoPinLocal {
  sucesso: boolean;
  funcionario?: { id: string; nome: string; cargo: Cargo };
  erro?: string;
}

async function obterEstadoTentativas(): Promise<EstadoTentativas | null> {
  const bruto = await obterConfiguracao(CHAVE_TENTATIVAS);
  if (!bruto) return null;
  try {
    return JSON.parse(bruto) as EstadoTentativas;
  } catch {
    return null;
  }
}

async function salvarEstadoTentativas(estado: EstadoTentativas): Promise<void> {
  await definirConfiguracao(CHAVE_TENTATIVAS, JSON.stringify(estado));
}

export async function validarPinLocalmente(pin: string): Promise<ResultadoValidacaoPinLocal> {
  const estado = await obterEstadoTentativas();

  if (estaBloqueado(estado)) {
    return { sucesso: false, erro: "Muitas tentativas. Tente novamente em alguns minutos." };
  }

  const db = getOfflineDB();
  const todos = await db.funcionarios_local.toArray();
  const ativos = todos.filter((f) => f.ativo);

  for (const funcionario of ativos) {
    const confere = await verificarPin(pin, funcionario.pin_hash);
    if (confere) {
      await salvarEstadoTentativas({ tentativas_falhas: 0, bloqueado_ate: null });
      return {
        sucesso: true,
        funcionario: { id: funcionario.id, nome: funcionario.nome, cargo: funcionario.cargo as Cargo },
      };
    }
  }

  const falhasAtuais = estado?.tentativas_falhas ?? 0;
  const bloquear = deveBloquear(falhasAtuais);
  await salvarEstadoTentativas({
    tentativas_falhas: falhasAtuais + 1,
    bloqueado_ate: bloquear ? calcularBloqueioAte() : null,
  });

  return {
    sucesso: false,
    erro: bloquear ? "Muitas tentativas. Tente novamente em alguns minutos." : "PIN incorreto.",
  };
}