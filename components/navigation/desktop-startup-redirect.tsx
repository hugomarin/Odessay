"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AppSplash } from "@/components/auth/app-splash"
import { isTauriRuntime } from "@/lib/runtime/detect"
import { createDesktopClient } from "@/lib/supabase/desktop-client"

type Phase =
  | { status: "idle" }
  | { status: "resolving" }
  | { status: "leaving" }
  | { status: "settled" }
  | { status: "failed"; message: string }

const bootErrorMessage =
  "We could not finish opening Artifact Studio. Your local artifacts are untouched."

/**
 * Baked at compile time by `scripts/prepare-tauri-build.mjs`, so it holds the
 * same value during the static export's prerender and in the browser. That is
 * what lets the splash be part of the first painted HTML instead of appearing
 * an effect later — evaluating `isTauriRuntime()` here would be false on the
 * server and true on the client, which is a hydration mismatch.
 */
const isDesktopBundle = process.env.NEXT_PUBLIC_TAURI_BUILD === "true"

/**
 * In the Tauri desktop build the app always starts at `/`. This resolves the
 * stored session and sends the user to /desk or /login, showing the splash
 * while it does.
 *
 * The splash has no minimum duration: it is on screen exactly as long as the
 * lookup takes. On web this renders nothing.
 */
export function DesktopStartupRedirect({
  /**
   * Set where the desktop build actually boots (`/`), so the splash is in the
   * first paint and the marketing homepage is never visible behind it. Left off
   * on `/login`, which mounts this too but already has its own screen to show.
   */
  eager = false
}: {
  eager?: boolean
} = {}) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>(() =>
    eager && isDesktopBundle ? { status: "resolving" } : { status: "idle" }
  )
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!isTauriRuntime()) return

    let active = true
    setPhase({ status: "resolving" })

    createDesktopClient()
      .auth.getSession()
      .then(({ data, error }) => {
        if (!active) return

        // A failed session read is not the same as "no session" — treating it as
        // one is what caused the loop in ODE-416. Surface it instead.
        if (error) {
          setPhase({ status: "failed", message: bootErrorMessage })
          return
        }

        const target = data.session ? "/desk" : "/login"

        // Already there — /login mounts this too. Drop the splash instead of
        // leaving it over a screen the user is supposed to be using.
        if (window.location.pathname === target) {
          setPhase({ status: "settled" })
          return
        }

        // Hold the splash through the navigation so the marketing homepage
        // never flashes behind it.
        setPhase({ status: "leaving" })
        router.replace(target)
      })
      .catch(() => {
        if (!active) return
        setPhase({ status: "failed", message: bootErrorMessage })
      })

    return () => {
      active = false
    }
  }, [router, attempt])

  const retry = useCallback(() => {
    setAttempt((current) => current + 1)
  }, [])

  // Only the boot route paints. On /login this component is a pure redirect:
  // that screen already has something to show, and covering it with the splash
  // would read as a second flash right after the first.
  if (!eager || phase.status === "idle" || phase.status === "settled") {
    return null
  }

  if (phase.status === "failed") {
    return <AppSplash error={phase.message} onRetry={retry} />
  }

  return <AppSplash caption="opening your desk…" />
}
