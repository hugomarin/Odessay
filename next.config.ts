import type { NextConfig } from "next"

const isTauriBuild = process.env.TAURI_BUILD === "true"

const nextConfig: NextConfig = {
  transpilePackages: ["@supabase/ssr"],
  serverExternalPackages: ["@react-pdf/renderer"],
  ...(isTauriBuild
    ? {
        output: "export",
        distDir: "dist",
        images: {
          unoptimized: true,
        },
      }
    : {}),
}

export default nextConfig
