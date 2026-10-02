// ODE-616 PR1 — costuras de sesión para los tests service-role. La sesión es
// el único boundary que se dobla: `serverClientAs` construye un cliente real
// con el token del usuario (RLS real) y `serverClientMockFactory` sustituye
// `@/lib/supabase/server#createClient` por ese cliente, fakeando solo el
// transporte de cookies. Los handlers que usan Bearer se atacan con
// `bearerRequest`.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { vi } from "vitest"
import { createUserClient, localSupabaseEnv, type UserSessionTokens } from "./local-supabase"

export async function serverClientAs(user: UserSessionTokens | null): Promise<SupabaseClient> {
  if (user) return createUserClient(user)
  const env = localSupabaseEnv()
  return createClient(env.url, env.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function serverClientMockFactory(user: UserSessionTokens | null) {
  return async () => serverClientAs(user)
}

export function emptyCookiesStore() {
  return {
    getAll: () => [],
    has: () => false,
    set: () => undefined,
    delete: () => undefined,
  }
}

export function mockEmptyCookies(): void {
  vi.doMock("next/headers", () => ({ cookies: async () => emptyCookiesStore() }))
}

export async function bearerRequest(
  url: string,
  user: UserSessionTokens,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${user.accessToken}`)
  return fetch(url, { ...init, headers })
}

async function captureDigest(run: () => unknown | Promise<unknown>): Promise<string | null> {
  try {
    await run()
    return null
  } catch (error) {
    const digest = (error as { digest?: unknown })?.digest
    return typeof digest === "string" ? digest : null
  }
}

export async function expectNotFound(run: () => unknown | Promise<unknown>): Promise<void> {
  const digest = await captureDigest(run)
  if (digest !== "NEXT_HTTP_ERROR_FALLBACK;404") {
    throw new Error(`[supabase-local] se esperaba notFound() (NEXT_HTTP_ERROR_FALLBACK;404) y llegó: ${digest ?? "sin digest"}`)
  }
}

export async function expectRedirect(run: () => unknown | Promise<unknown>, to: string): Promise<void> {
  const digest = await captureDigest(run)
  if (!digest?.includes("NEXT_REDIRECT") || !digest.includes(to)) {
    throw new Error(`[supabase-local] se esperaba redirect() a ${to} y llegó: ${digest ?? "sin digest"}`)
  }
}
