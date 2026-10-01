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
    exclude: ["**/node_modules/**", "**/.claude/**", "**/tmp/**"],
    // ODE-656: CI retries a failing test once, so a load flake does not fail the
    // required suite. Local runs never retry. A retried pass is not a fix: the
    // reporter prints the retry, and a test that needs it gets a flake issue.
    retry: process.env.CI ? 1 : 0,
  },
});
