import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/shared"

const AUTH_ROUTES = ["/login", "/signup"]
const PRIVATE_ROUTES = ["/desk", "/write", "/collections", "/correspondences", "/shared", "/settings"]

const matchesRoute = (pathname: string, routes: string[]) =>
  routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))

export const updateSession = async (request: NextRequest) => {
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

  const { pathname, search } = request.nextUrl

  if (pathname.startsWith("/api")) {
    return response
  }

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
