"use client"

import Link from "next/link"
import { type FormEvent, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getResetPasswordRedirectUrl,
  normalizeEmail,
  validateForgotPasswordValues,
  type AuthFieldErrors,
} from "@/lib/auth/validation"
import { createAuthClient } from "@/lib/supabase/client-auth"

const successMessage =
  "If an Odessay account exists for that email, Supabase will send a recovery link."
const sendErrorMessage =
  "We could not send a recovery link right now. Please wait a moment and try again."

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [errors, setErrors] = useState<AuthFieldErrors>({})
  const [status, setStatus] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors = validateForgotPasswordValues({ email })
    setErrors(nextErrors)
    setStatus(null)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    startTransition(async () => {
      const supabase = createAuthClient()
      const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
        redirectTo: `${window.location.origin.replace(/\/$/, "")}/auth/verify`,
      })

      console.log("[debug] after resetPasswordForEmail:")
      console.log("[debug] document.cookie:", document.cookie)
      console.log("[debug] localStorage keys:", Object.keys(localStorage))
      console.log("[debug] localStorage 'sb-...-auth-token-code-verifier':", localStorage.getItem("sb-vkdvprzxyccgmhifwmfz-auth-token-code-verifier"))

      if (error) {
        setErrors({ form: sendErrorMessage })
        return
      }

      setErrors({})
      setStatus(successMessage)
    })
  }

  return (
    <section id="forgot-password" data-page="forgot-password" className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-lora text-[2rem] font-medium leading-[1.18] tracking-[-0.01em] text-ink">
          Reset your password
        </h1>
        <p className="max-w-sm text-sm leading-6 text-ink-3">
          Enter your email and we&apos;ll send a recovery link if the account exists.
        </p>
      </div>

      <form
        id="forgot-password-form"
        data-section="forgot-password-form"
        data-testid="forgot-password-form"
        className="ForgotPasswordForm space-y-5"
        onSubmit={handleSubmit}
      >
        <div className="space-y-2">
          <label className="text-[13px] font-medium text-ink-2" htmlFor="forgot-password-email">
            Email
          </label>
          <Input
            id="forgot-password-email"
            autoCapitalize="none"
            autoComplete="email"
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(errors.email)}
          />
          {errors.email ? <p className="text-[13px] text-destructive">{errors.email}</p> : null}
        </div>

        {status ? (
          <p className="rounded-[8px] border-[0.5px] border-border bg-muted px-3 py-2 text-[13px] text-ink-3">
            {status}
          </p>
        ) : null}

        {errors.form ? (
          <p className="rounded-[8px] border-[0.5px] border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
            {errors.form}
          </p>
        ) : null}

        <Button className="h-11 w-full text-[14px]" disabled={isPending} type="submit">
          {isPending ? "Sending link..." : "Send recovery link"}
        </Button>

        <p className="text-[13px] text-ink-4">
          Remembered it?{" "}
          <Link className="font-medium text-ink-2 transition-colors hover:text-ink" href="/login">
            Log in
          </Link>
        </p>
      </form>
    </section>
  )
}
