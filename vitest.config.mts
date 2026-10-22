import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Alguns testes geram PDFs (lento); com a suíte toda em paralelo o limite padrão de 5 s estoura sem haver defeito.
    testTimeout: 30_000,
  },
});
