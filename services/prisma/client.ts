import { PrismaClient } from "@prisma/client";

/**
 * Cliente Prisma único usado por TODO acesso a dados deste sistema
 * (Server Actions e Server Components — nunca o navegador).
 *
 * Conecta no PostgreSQL via DATABASE_URL (no Railway, a variável é
 * injetada automaticamente pelo plugin de Postgres). Em desenvolvimento,
 * o hot reload do Next recriaria o cliente a cada alteração e esgotaria
 * as conexões — por isso a instância é guardada em globalThis.
 */
const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalParaPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalParaPrisma.prisma = prisma;
}
