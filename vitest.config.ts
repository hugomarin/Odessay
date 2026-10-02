import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    // ODE-616: la suite unitaria no recoge los `.supabase.test.*` (tienen su
    // propio runner y necesitan el stack local) ni las copias de recon que
    // quedan bajo `.cache/**`.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/tmp/**", "**/.cache/**", "**/*.supabase.test.*"],
    // ODE-656: CI retries a test once, only when it failed on a timeout. Load
    // flakes in this suite are timeouts (the harness "waitFor/settleUntil agotó
    // Nms", vitest's "Test timed out"). The condition also keeps it.fails tests
    // from being re-run, since their red body fails on an assertion. Local runs
    // never retry. A retried pass is not a fix: the verbose reporter prints
    // "(retry x1)" in CI, and a test that needs it gets a flake issue.
    retry: process.env.CI ? { count: 1, condition: /agotó \d+ms|timed out/i } : 0,
  },
});
