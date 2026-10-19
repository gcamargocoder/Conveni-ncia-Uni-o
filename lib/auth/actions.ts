"use server";

import { headers } from "next/headers";
import { autenticarPorPin } from "@/services/funcionarios.service";
import { prisma } from "@/services/prisma/client";
import {
  estaBloqueado,
  deveBloquear,
  calcularBloqueioAte,
  EstadoTentativas,
} from "@/lib/auth/protecao-forca-bruta";
import { Cargo } from "@/types/funcionario";

export interface ResultadoAutenticacao {
  sucesso: boolean;
  funcionario?: { id: string; nome: string; cargo: Cargo };
  erro?: string;
}

async function obterIdentificador(): Promise<string> {
  const h = await headers();
  // atrás de proxy/load balancer, x-forwarded-for tem o IP real primeiro
  return h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? "desconhecido";
}

/**
 * Server Action: recebe o PIN, nunca expõe hash nem lista de
 * funcionários para o navegador. Protegida contra força bruta:
 * bloqueia a origem após MAX_TENTATIVAS falhas seguidas.
 */
export async function validarPinAction(pin: string): Promise<ResultadoAutenticacao> {
  const identificador = await obterIdentificador();

  const registro = await prisma.tentativaPin.findUnique({
    where: { identificador },
    select: { tentativas_falhas: true, bloqueado_ate: true },
  });
  const estado: EstadoTentativas | null = registro && {
    tentativas_falhas: registro.tentativas_falhas,
    bloqueado_ate: registro.bloqueado_ate?.toISOString() ?? null,
  };

  if (estaBloqueado(estado)) {
    return { sucesso: false, erro: "Muitas tentativas. Tente novamente em alguns minutos." };
  }

  const funcionario = await autenticarPorPin(pin);

  if (!funcionario) {
    const falhasAtuais = estado?.tentativas_falhas ?? 0;
    const bloquear = deveBloquear(falhasAtuais);

    const novoEstado = {
      tentativas_falhas: falhasAtuais + 1,
      bloqueado_ate: bloquear ? new Date(calcularBloqueioAte()) : null,
      updated_at: new Date(),
    };
    await prisma.tentativaPin.upsert({
      where: { identificador },
      create: { identificador, ...novoEstado },
      update: novoEstado,
    });

    return {
      sucesso: false,
      erro: bloquear
        ? "Muitas tentativas. Tente novamente em alguns minutos."
        : "PIN incorreto.",
    };
  }

  // sucesso: zera o contador de tentativas falhas desta origem
  const estadoZerado = { tentativas_falhas: 0, bloqueado_ate: null, updated_at: new Date() };
  await prisma.tentativaPin.upsert({
    where: { identificador },
    create: { identificador, ...estadoZerado },
    update: estadoZerado,
  });

  return {
    sucesso: true,
    funcionario: {
      id: funcionario.id,
      nome: funcionario.nome,
      cargo: funcionario.cargo,
    },
  };
}
