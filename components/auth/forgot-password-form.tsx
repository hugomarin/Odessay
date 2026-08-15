"use client"

import { MailCheck } from "lucide-react"
import Link from "next/link"
import { type FormEvent, useRef, useState, useTransition } from "react"
import { AuthCard, AuthField } from "@/components/auth/auth-card"
import {
  getConfiguredResetPasswordRedirectUrl,
  getResetPasswordRedirectUrl,
  normalizeEmail,
  validateForgotPasswordValues,
  type AuthFieldErrors
} from "@/lib/auth/validation"
import { isTauriRuntime } from "@/lib/runtime/detect"
import { createDesktopClient } from "@/lib/supabase/desktop-client"
import { createClient } from "@/lib/supabase/client"

const sendErrorMessage = "We could not send a recovery link right now. Please wait a moment and try again."

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [errors, setErrors] = useState<AuthFieldErrors>({})
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()
  const inFlight = useRef(false)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (inFlight.current) {
      return
    }

    const nextErrors = validateForgotPasswordValues({ email })
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    inFlight.current = true

    startTransition(async () => {
      try {
        const desktop = isTauriRuntime()
        const supabase = desktop ? createDesktopClient() : createClient()
        const redirectTo = desktop
          ? getConfiguredResetPasswordRedirectUrl()
          : getResetPasswordRedirectUrl(window.location.origin)

        const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
          redirectTo
        })

        if (error) {
          setErrors({ form: sendErrorMessage })
          return
        }

        setErrors({})
        setSent(true)
      } finally {
        inFlight.current = false
      }
    })
  }

  // Success is a state of this card, not a new page.
  if (sent) {
    return (
      <AuthCard
        subtitle={`If an Artifact Studio account exists for ${normalizeEmail(email)}, a recovery link is on its way. The link opens a page where you can set a new password.`}
        tile={
          <span className="od-auth-success-tile">
            <MailCheck size={24} />
          </span>
        }
        title="Check your email"
      >
        <p className="od-auth-switch">
          Wrong address?{" "}
          <button className="od-auth-switch-button" onClick={() => setSent(false)} type="button">
            Use a different one
          </button>
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      subtitle="Enter your email and we'll send a recovery link if the account exists. Your local artifacts are not affected either way."
      title="Reset your password"
    >
      <form
        className="od-auth-fields"
        data-testid="forgot-password-form"
        noValidate
        onSubmit={handleSubmit}
      >
        <AuthField
          autoCapitalize="none"
          autoComplete="email"
          error={errors.email}
          id="forgot-password-email"
          label="Email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@domain.com"
          type="email"
          value={email}
        />

        {errors.form ? (
          <p className="od-auth-error" role="alert">
            {errors.form}
          </p>
        ) : null}

        <button className="od-auth-primary" disabled={isPending} type="submit">
          {isPending ? "Sending link…" : "Send recovery link"}
        </button>
      </form>

      <p className="od-auth-switch">
        Remembered it?{" "}
        <Link className="od-auth-switch-button" href="/login">
          Sign in
        </Link>
      </p>
    </AuthCard>
  )
}
