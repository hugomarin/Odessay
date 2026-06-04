/**
 * Adds CORS headers to API responses so the desktop DMG (origin: tauri://localhost)
 * can call the hosted web AI runtime cross-origin.
 *
 * Web browser requests from the same origin don't need CORS and are unaffected.
 */

const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https:\/\/odessay\.vercel\.app$/,
  /^tauri:\/\/localhost$/,
]

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))
}

export function withCorsHeaders(
  response: Response,
  request: Request,
): Response {
  const origin = request.headers.get("origin")

  if (origin && isAllowedOrigin(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin)
    response.headers.set("Access-Control-Allow-Credentials", "true")
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
  }

  return response
}

export function handleCorsPreflight(request: Request): Response | null {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin")

    if (origin && isAllowedOrigin(origin)) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      })
    }
  }

  return null
}
