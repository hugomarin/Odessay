import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  transpilePackages: ["@supabase/ssr"],
}

export default nextConfig
