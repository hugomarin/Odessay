import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/shared"

const AUTH_ROUTES = ["/login", "/signup"]
const PRIVATE_ROUTES = ["/desk", "/write", "/collections", "/correspondences", "/shared", "/settings"]
const AUTH_CONFIRM_TYPES = new Set(["email", "recovery", "email_change", "invite", "magiclink", "signup"])

const matchesRoute = (pathname: string, routes: string[]) =>
  routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))

const sanitizeRedirectPath = (candidate: string | null, fallback: string) => {
  if (!candidate) {
    return fallback
  }

  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("://")) {
    return fallback
  }

  return candidate
}

const getDefaultNextForAuthType = (type: string) => {
  switch (type) {
    case "recovery":
      return "/reset-password"
    case "email_change":
      return "/settings/account"
    default:
      return "/desk"
  }
}

export function extractMalformedAuthRedirect(pathname: string, search: string) {
  if (!pathname.startsWith("/&token_hash=")) {
    return null
  }

  const rawParams = pathname.slice(2) + (search ? `&${search.replace(/^\?/, "")}` : "")
  const params = new URLSearchParams(rawParams)
  const tokenHash = params.get("token_hash")
  const type = params.get("type")

  if (!tokenHash || !type || !AUTH_CONFIRM_TYPES.has(type)) {
    return null
  }

  return {
    tokenHash,
    type,
    next: sanitizeRedirectPath(params.get("next"), getDefaultNextForAuthType(type)),
  }
}

export const updateSession = async (request: NextRequest) => {
  const { pathname, search } = request.nextUrl
  const malformedAuthRedirect = extractMalformedAuthRedirect(pathname, search)

  if (malformedAuthRedirect) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = "/auth/confirm"
    redirectUrl.search = ""
    redirectUrl.searchParams.set("token_hash", malformedAuthRedirect.tokenHash)
    redirectUrl.searchParams.set("type", malformedAuthRedirect.type)
    redirectUrl.searchParams.set("next", malformedAuthRedirect.next)
    return NextResponse.redirect(redirectUrl)
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.next({
      request,
    })
  }

  if (pathname.startsWith("/perf")) {
    return NextResponse.next({
      request,
    })
  }

  let response = NextResponse.next({
    request,
  })

  const supabase = createServerClient(supabaseUrl, supabasePublicKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(
        cookiesToSet: Array<{
          name: string
          value: string
          options?: CookieOptions
        }>,
      ) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({
          request,
        })
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && matchesRoute(pathname, PRIVATE_ROUTES)) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = "/login"

    if (pathname !== "/login") {
      redirectUrl.searchParams.set("next", `${pathname}${search}`)
    }

    return NextResponse.redirect(redirectUrl)
  }

  if (user && matchesRoute(pathname, AUTH_ROUTES)) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = "/desk"
    redirectUrl.search = ""
    return NextResponse.redirect(redirectUrl)
  }

  return response
}
