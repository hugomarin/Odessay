"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { type FormEvent, useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  normalizeEmail,
  sanitizeRedirectPath,
  toFriendlyAuthError,
  validateLoginValues,
  type AuthFieldErrors,
} from "@/lib/auth/validation"
import { isTauriRuntime } from "@/lib/runtime/detect"
import { webAuthService } from "@/lib/services/web-auth-service"

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [errors, setErrors] = useState<AuthFieldErrors>({})
  const [email, setEmail] = useState(searchParams.get("email") ?? "")
  const [password, setPassword] = useState("")
  const [isPending, startTransition] = useTransition()
  const needsEmailConfirmation = searchParams.get("checkEmail") === "1"

  const redirectTo = useMemo(
    () => sanitizeRedirectPath(searchParams.get("next")),
    [searchParams],
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors = validateLoginValues({ email, password })
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    startTransition(async () => {
      const result = await webAuthService.signIn({
        email: normalizeEmail(email),
        password,
      })

      if (result.error) {
        setErrors({ form: toFriendlyAuthError(result.error.message) })
        return
      }

      router.replace(redirectTo)
      if (!isTauriRuntime()) {
        router.refresh()
      }
    })
  }

  return (
    <section
      id="login"
      data-page="login"
      className="space-y-8"
    >
      <div className="space-y-2">
        <h1 className="font-lora text-[2rem] font-medium leading-[1.18] tracking-[-0.01em] text-ink">
          {needsEmailConfirmation ? "Check your email" : "Login"}
        </h1>
        <p className="max-w-sm text-sm leading-6 text-ink-3">
          {needsEmailConfirmation
            ? "Open the confirmation link we sent to activate your account."
            : "Return to your desk and continue writing where you left off."}
        </p>
      </div>

      <form
        id="login-form"
        data-section="login-form"
        data-testid="login-form"
        className="LoginForm space-y-5"
        onSubmit={handleSubmit}
      >
        {needsEmailConfirmation ? (
          <div className="space-y-2 rounded-[8px] border-[0.5px] border-border bg-muted px-3 py-3 text-[13px] text-ink-3">
            <p>Your account was created.</p>
            <p>We sent a confirmation link to {email || "your email address"}.</p>
            <p>Use that link to activate your account and continue directly to Odessay.</p>
          </div>
        ) : null}

        {!needsEmailConfirmation ? (
          <div className="space-y-2">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="login-email">
              Email
            </label>
            <Input
              id="login-email"
              autoComplete="email"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(errors.email)}
            />
            {errors.email ? <p className="text-[13px] text-destructive">{errors.email}</p> : null}
          </div>
        ) : null}

        {!needsEmailConfirmation ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-[13px] font-medium text-ink-2" htmlFor="login-password">
                Password
              </label>
              <Link className="text-[12px] text-ink-4 transition-colors hover:text-ink-2" href="/forgot-password">
                Forgot your password?
              </Link>
            </div>
            <Input
              id="login-password"
              autoComplete="current-password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(errors.password)}
            />
            {errors.password ? <p className="text-[13px] text-destructive">{errors.password}</p> : null}
          </div>
        ) : null}

        {errors.form ? (
          <p className="rounded-[8px] border-[0.5px] border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
            {errors.form}
          </p>
        ) : null}

        {!needsEmailConfirmation ? (
          <Button className="h-11 w-full text-[14px]" disabled={isPending} type="submit">
            {isPending ? "Logging in..." : "Login"}
          </Button>
        ) : null}

        <p className="text-[13px] text-ink-4">
          Don&apos;t have an account?{" "}
          <Link className="font-medium text-ink-2 transition-colors hover:text-ink" href="/signup">
            Sign up
          </Link>
        </p>
      </form>
    </section>
  )
}
