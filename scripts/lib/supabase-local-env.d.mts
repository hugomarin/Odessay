export const LOCAL_SUPABASE_HOSTS: string[]

export function isLocalSupabaseUrl(url: unknown): boolean

export function readSupabaseStatus(options?: { cwd?: string; command?: string }): Record<string, unknown> | null

export function localEnvFromStatus(status: Record<string, unknown> | null): {
  NEXT_PUBLIC_SUPABASE_URL: string | undefined
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: string | undefined
  SUPABASE_SERVICE_ROLE_KEY: string | undefined
}

export function assertLocalSupabaseEnv(env: {
  NEXT_PUBLIC_SUPABASE_URL?: string
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}): { url: string; publishableKey: string; serviceRoleKey: string }

export function sanitizeSupabaseEnv(
  baseEnv: Record<string, string | undefined>,
  localEnv: Record<string, string | undefined>,
): Record<string, string | undefined>

export function resolveGitCommonDir(options?: { cwd?: string }): string | null

export function readSupabaseProjectId(options?: { cwd?: string }): string
