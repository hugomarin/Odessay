"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { type FormEvent, useEffect, useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  toFriendlyAuthError,
  validateResetPasswordValues,
  type AuthFieldErrors,
} from "@/lib/auth/validation"
import { createAuthClient } from "@/lib/supabase/client-auth"

type RecoveryState =
  | { status: "checking"; message: string }
  | { status: "ready"; message: string | null }
  | { status: "invalid"; message: string }
  | { status: "updated"; message: string }

const recoveryErrorMessage =
  "This recovery link is invalid or expired. Request a new link to reset your password."
const recoverySessionStorageKey = "odessay-password-recovery-session"

const getHashParams = () => new URLSearchParams(window.location.hash.replace(/^#/, ""))

export function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [errors, setErrors] = useState<AuthFieldErrors>({})
  const [recoveryState, setRecoveryState] = useState<RecoveryState>({
    status: "checking",
    message: "Checking recovery link...",
  })
  const [isPending, startTransition] = useTransition()

  const queryError = useMemo(
    () => searchParams.get("error_description") ?? searchParams.get("error"),
    [searchParams],
  )

  useEffect(() => {
    let active = true
    const supabase = createAuthClient()

    const establishRecoverySession = async () => {
      if (queryError) {
        setRecoveryState({ status: "invalid", message: recoveryErrorMessage })
        return
      }

      const hashParams = getHashParams()
      const hashError = hashParams.get("error_description") ?? hashParams.get("error")

      if (hashError) {
        setRecoveryState({ status: "invalid", message: recoveryErrorMessage })
        return
      }

      const code = searchParams.get("code")

      if (code) {
        console.log("[debug] before exchangeCodeForSession:")
        console.log("[debug] document.cookie:", document.cookie)
        console.log("[debug] localStorage keys:", Object.keys(localStorage))
        console.log("[debug] localStorage 'sb-...-auth-token-code-verifier':", localStorage.getItem("sb-vkdvprzxyccgmhifwmfz-auth-token-code-verifier"))

        const { error } = await supabase.auth.exchangeCodeForSession(code)

        if (!active) {
          return
        }

        if (error) {
          console.error("[reset-password] exchangeCodeForSession failed:", error.message, error)
          setRecoveryState({ status: "invalid", message: recoveryErrorMessage })
          return
        }

        window.history.replaceState(null, "", "/reset-password")
        window.sessionStorage.setItem(recoverySessionStorageKey, "1")
        setRecoveryState({ status: "ready", message: null })
        return
      }

      const accessToken = hashParams.get("access_token")
      const refreshToken = hashParams.get("refresh_token")

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })

        if (!active) {
          return
        }

        if (error) {
          setRecoveryState({ status: "invalid", message: recoveryErrorMessage })
          return
        }

        window.history.replaceState(null, "", "/reset-password")
        window.sessionStorage.setItem(recoverySessionStorageKey, "1")
        setRecoveryState({ status: "ready", message: null })
        return
      }

      const hasRecoverySession = window.sessionStorage.getItem(recoverySessionStorageKey) === "1"

      if (!hasRecoverySession) {
        setRecoveryState({ status: "invalid", message: recoveryErrorMessage })
        return
      }

      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!active) {
        return
      }

      setRecoveryState(
        session
          ? { status: "ready", message: null }
          : { status: "invalid", message: recoveryErrorMessage },
      )
    }

    void establishRecoverySession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && active) {
        window.sessionStorage.setItem(recoverySessionStorageKey, "1")
        setRecoveryState({ status: "ready", message: null })
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [queryError, searchParams])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors = validateResetPasswordValues({ password, confirmPassword })
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0 || recoveryState.status !== "ready") {
      return
    }

    startTransition(async () => {
      const supabase = createAuthClient()
      const { error } = await supabase.auth.updateUser({ password })

      if (error) {
        setErrors({ form: toFriendlyAuthError(error.message) })
        return
      }

      setPassword("")
      setConfirmPassword("")
      setErrors({})
      setRecoveryState({
        status: "updated",
        message: "Your password was updated. Continue to your desk.",
      })
      window.sessionStorage.removeItem(recoverySessionStorageKey)
      router.refresh()
    })
  }

  const canSubmit = recoveryState.status === "ready" && !isPending

  return (
    <section id="reset-password" data-page="reset-password" className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-lora text-[2rem] font-medium leading-[1.18] tracking-[-0.01em] text-ink">
          Choose a new password
        </h1>
        <p className="max-w-sm text-sm leading-6 text-ink-3">
          Use at least 8 characters. After saving, you can continue to your desk.
        </p>
      </div>

      {recoveryState.status === "invalid" ? (
        <div className="space-y-4">
          <p className="rounded-[8px] border-[0.5px] border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
            {recoveryState.message}
          </p>
          <Button asChild className="h-11 w-full text-[14px]">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        </div>
      ) : recoveryState.status === "updated" ? (
        <div className="space-y-4">
          <p className="rounded-[8px] border-[0.5px] border-border bg-muted px-3 py-2 text-[13px] text-ink-3">
            {recoveryState.message}
          </p>
          <Button asChild className="h-11 w-full text-[14px]">
            <Link href="/desk">Continue to desk</Link>
          </Button>
        </div>
      ) : (
        <form
          id="reset-password-form"
          data-section="reset-password-form"
          data-testid="reset-password-form"
          className="ResetPasswordForm space-y-5"
          onSubmit={handleSubmit}
        >
          {recoveryState.status === "checking" ? (
            <p className="rounded-[8px] border-[0.5px] border-border bg-muted px-3 py-2 text-[13px] text-ink-3">
              {recoveryState.message}
            </p>
          ) : null}

          <div className="space-y-2">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="reset-password-new">
              New password
            </label>
            <Input
              id="reset-password-new"
              autoComplete="new-password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(errors.password)}
              disabled={recoveryState.status !== "ready"}
            />
            {errors.password ? <p className="text-[13px] text-destructive">{errors.password}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="reset-password-confirm">
              Confirm password
            </label>
            <Input
              id="reset-password-confirm"
              autoComplete="new-password"
              name="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              aria-invalid={Boolean(errors.confirmPassword)}
              disabled={recoveryState.status !== "ready"}
            />
            {errors.confirmPassword ? (
              <p className="text-[13px] text-destructive">{errors.confirmPassword}</p>
            ) : null}
          </div>

          {errors.form ? (
            <p className="rounded-[8px] border-[0.5px] border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
              {errors.form}
            </p>
          ) : null}

          <Button className="h-11 w-full text-[14px]" disabled={!canSubmit} type="submit">
            {isPending ? "Updating password..." : "Update password"}
          </Button>
        </form>
      )}
    </section>
  )
}
