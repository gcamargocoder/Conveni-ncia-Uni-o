import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // Testes de integração exigem um PostgreSQL de teste: rodam com `npm run test:integracao`.
    exclude: [...configDefaults.exclude, "**/*.integracao.test.ts"],
  },
});
