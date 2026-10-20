import { prisma } from "@/services/prisma/client";
import { gerarHashSenha, normalizarEmail } from "@/lib/auth/senha";

/**
 * Fixture de testes: simula contas que já existem no banco (ex.: legadas), gravando direto.
 * O código da aplicação NÃO tem mais função para criar contas de login (ver AUTENTICACAO.md).
 */
export async function criarUsuarioDeTeste(dados: { nome: string; email: string; senha: string; papel: "admin" | "operador" }) {
  return prisma.usuario.create({
    data: {
      nome: dados.nome,
      email: normalizarEmail(dados.email),
      papel: dados.papel,
      senha_hash: await gerarHashSenha(dados.senha),
      senha_alterada_em: new Date(),
    },
    select: { id: true, nome: true, email: true, papel: true, ativo: true },
  });
}
