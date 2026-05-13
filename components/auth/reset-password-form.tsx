"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { type FormEvent, useEffect, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  toFriendlyAuthError,
  validateResetPasswordValues,
  type AuthFieldErrors,
} from "@/lib/auth/validation"
import { createClient } from "@/lib/supabase/client"

type RecoveryState =
  | { status: "checking"; message: string }
  | { status: "ready"; message: string | null }
  | { status: "invalid"; message: string }
  | { status: "updated"; message: string }

const recoveryErrorMessage =
  "This recovery link is invalid or expired. Request a new link to reset your password."

export function ResetPasswordForm() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [errors, setErrors] = useState<AuthFieldErrors>({})
  const [recoveryState, setRecoveryState] = useState<RecoveryState>({
    status: "checking",
    message: "Checking recovery link...",
  })
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let active = true
    const supabase = createClient()

    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!active) return

      setRecoveryState(
        session
          ? { status: "ready", message: null }
          : { status: "invalid", message: recoveryErrorMessage },
      )
    }

    void checkSession()

    return () => {
      active = false
    }
  }, [])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors = validateResetPasswordValues({ password, confirmPassword })
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0 || recoveryState.status !== "ready") {
      return
    }

    startTransition(async () => {
      const supabase = createClient()
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
