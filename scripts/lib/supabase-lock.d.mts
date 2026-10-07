export function supabaseLockPath(options?: { cwd?: string }): string

export function acquireSupabaseLock(options?: {
  cwd?: string
  waitMs?: number
  pollMs?: number
}): Promise<{ path: string; release(): void }>
