// Executa ANTES de qualquer módulo de teste ser carregado: aponta o Prisma para o
// banco de TESTE e recusa qualquer outro, para que estes testes (que apagam
// tabelas) jamais rodem contra dados reais.
const url = process.env.TEST_DATABASE_URL;

if (!url) {
  throw new Error("Defina TEST_DATABASE_URL (PostgreSQL descartável cujo nome termine em _test).");
}

const nomeDoBanco = new URL(url).pathname.replace(/^\//, "");
if (!nomeDoBanco.endsWith("_test")) {
  throw new Error(`Recusado: o banco de teste deve terminar em "_test" (recebido: "${nomeDoBanco}").`);
}

process.env.DATABASE_URL = url;

// A trava de conta única do banco (gatilho usuarios_conta_unica) é DESLIGADA no banco de teste,
// porque os testes montam vários usuários como fixture. Os testes da própria trava a religam.
import { beforeAll } from "vitest";
beforeAll(async () => {
  const { prisma } = await import("./services/prisma/client");
  await prisma.$executeRawUnsafe(
    "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'usuarios_conta_unica') THEN ALTER TABLE usuarios DISABLE TRIGGER usuarios_conta_unica; END IF; END $$"
  );
});
