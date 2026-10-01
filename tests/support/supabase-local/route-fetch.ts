// ODE-616 PR1 — fetch enrutado del harness. Las llamadas a `/api/...` entran
// al handler real con el Bearer del usuario; las que van a
// `http://127.0.0.1:54321` usan el fetch real; cualquier otra URL es un error,
// para que un cliente que se escape a un host remoto falle ruidosamente.

import type { UserSessionTokens } from "./local-supabase"

export type RouteHandler = (request: Request) => Promise<Response> | Response

const LOCAL_STACK_ORIGIN = "http://127.0.0.1:54321"

export function createRouteFetch(
  routes: Record<string, RouteHandler>,
  options: { as?: UserSessionTokens | null } = {},
) {
  return async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)

    if (url.origin === LOCAL_STACK_ORIGIN) {
      return fetch(request)
    }

    const handler = routes[url.pathname]
    if (!handler) {
      throw new Error(
        `[supabase-local] createRouteFetch: URL fuera del harness (${url.origin}${url.pathname}). ` +
          "Solo se aceptan rutas registradas y el stack local en " +
          `${LOCAL_STACK_ORIGIN}.`,
      )
    }

    const headers = new Headers(request.headers)
    if (options.as) headers.set("authorization", `Bearer ${options.as.accessToken}`)
    return handler(new Request(request, { headers }))
  }
}
