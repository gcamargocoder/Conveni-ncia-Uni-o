import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Testes de integração de autenticação — usam um PostgreSQL REAL de teste.
 * Exigem TEST_DATABASE_URL apontando para um banco descartável (o nome do
 * banco precisa terminar em "_test"). Ver vitest.integracao.setup.ts.
 */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "node",
    include: ["**/*.integracao.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    setupFiles: ["./vitest.integracao.setup.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
