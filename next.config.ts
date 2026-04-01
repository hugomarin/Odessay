import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@supabase/ssr"],
  serverExternalPackages: ["@react-pdf/renderer"],
}

export default nextConfig
