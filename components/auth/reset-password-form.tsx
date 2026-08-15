"use client"

import { CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react"
import { AuthCard, AuthPasswordField, passwordHint } from "@/components/auth/auth-card"
import { toFriendlyAuthError, validateResetPasswordValues, type AuthFieldErrors } from "@/lib/auth/validation"
import { createClient } from "@/lib/supabase/client"

type RecoveryState =
  | { status: "checking" }
  | { status: "ready" }
  | { status: "invalid"; message: string }
  | { status: "updated" }

const recoveryErrorMessage =
  "This recovery link is invalid or expired. Request a new link to reset your password."

export function ResetPasswordForm() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [errors, setErrors] = useState<AuthFieldErrors>({})
  const [recoveryState, setRecoveryState] = useState<RecoveryState>({ status: "checking" })
  const [isPending, startTransition] = useTransition()
  const inFlight = useRef(false)

  useEffect(() => {
    let active = true
    const supabase = createClient()

    const checkSession = async () => {
      try {
        const {
          data: { session }
        } = await supabase.auth.getSession()

        if (!active) return

        setRecoveryState(session ? { status: "ready" } : { status: "invalid", message: recoveryErrorMessage })
      } catch {
        // A failed read is not proof there is no session, but this screen can
        // only proceed with one, so it says so plainly instead of looping.
        if (!active) return
        setRecoveryState({
          status: "invalid",
          message: "We could not verify this recovery link. Check your connection and request a new one."
        })
      }
    }

    void checkSession()

    return () => {
      active = false
    }
  }, [])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (inFlight.current) {
      return
    }

    const nextErrors = validateResetPasswordValues({ password, confirmPassword })
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0 || recoveryState.status !== "ready") {
      return
    }

    inFlight.current = true

    startTransition(async () => {
      try {
        const supabase = createClient()
        const { error } = await supabase.auth.updateUser({ password })

        if (error) {
          setErrors({ form: toFriendlyAuthError(error.message) })
          return
        }

        setPassword("")
        setConfirmPassword("")
        setErrors({})
        setRecoveryState({ status: "updated" })
        router.refresh()
      } finally {
        inFlight.current = false
      }
    })
  }

  if (recoveryState.status === "invalid") {
    return (
      <AuthCard subtitle={recoveryState.message} title="Link expired">
        <Link className="od-auth-primary" href="/forgot-password">
          Request a new link
        </Link>
      </AuthCard>
    )
  }

  if (recoveryState.status === "updated") {
    return (
      <AuthCard
        subtitle="Your password was updated. You can continue to your desk."
        tile={
          <span className="od-auth-success-tile">
            <CheckCircle2 size={24} />
          </span>
        }
        title="Password updated"
      >
        <Link className="od-auth-primary" href="/desk">
          Continue to desk
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      subtitle="Use at least 8 characters. After saving, you can continue to your desk."
      title="Choose a new password"
    >
      <form
        className="od-auth-fields"
        data-testid="reset-password-form"
        noValidate
        onSubmit={handleSubmit}
      >
        <AuthPasswordField
          autoComplete="new-password"
          disabled={recoveryState.status !== "ready"}
          error={errors.password}
          hint={passwordHint(password)}
          id="reset-password-new"
          label="New password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••"
          value={password}
        />

        <AuthPasswordField
          autoComplete="new-password"
          disabled={recoveryState.status !== "ready"}
          error={errors.confirmPassword}
          id="reset-password-confirm"
          label="Confirm password"
          name="confirmPassword"
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="••••••••"
          value={confirmPassword}
        />

        {errors.form ? (
          <p className="od-auth-error" role="alert">
            {errors.form}
          </p>
        ) : null}

        <button
          className="od-auth-primary"
          disabled={recoveryState.status !== "ready" || isPending}
          type="submit"
        >
          {isPending ? "Updating password…" : "Update password"}
        </button>
      </form>
    </AuthCard>
  )
}
