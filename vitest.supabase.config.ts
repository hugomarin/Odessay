import path from "node:path"
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

// ODE-616 PR1 — config del harness Vitest ↔ Supabase local. No usa
// mergeConfig: el exclude de la config base concatena arrays y heredaría
// `**/*.supabase.test.*`, con lo que esta suite no correría nada. Tampoco
// llama loadEnv: el entorno lo fija `scripts/run-supabase-tests.mjs` desde
// `supabase status -o json`. Sin `passWithNoTests`: 0 tests es un fallo.
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
    include: ["tests/**/*.supabase.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.claude/**", "**/tmp/**", "**/.cache/**"],
    setupFiles: ["tests/support/supabase-local/guard.ts"],
    fileParallelism: false,
    testTimeout: 30000,
  },
})
