"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { type FormEvent, useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import {
  normalizeEmail,
  sanitizeRedirectPath,
  toFriendlyAuthError,
  validateLoginValues,
  type AuthFieldErrors,
} from "@/lib/auth/validation"

const supportHref = "mailto:hello@odessay.com?subject=Password%20reset"

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
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizeEmail(email),
        password,
      })

      if (error) {
        setErrors({ form: toFriendlyAuthError(error.message) })
        return
      }

      router.replace(redirectTo)
      router.refresh()
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
          Login
        </h1>
        <p className="max-w-sm text-sm leading-6 text-ink-3">
          Return to your desk and continue writing where you left off.
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
          <p className="rounded-[8px] border-[0.5px] border-border bg-muted px-3 py-2 text-[13px] text-ink-3">
            Your account was created. Confirm your email if required, then log in.
          </p>
        ) : null}

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

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="login-password">
              Password
            </label>
            <Link className="text-[12px] text-ink-4 transition-colors hover:text-ink-2" href={supportHref}>
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

        {errors.form ? (
          <p className="rounded-[8px] border-[0.5px] border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
            {errors.form}
          </p>
        ) : null}

        <Button className="h-11 w-full text-[14px]" disabled={isPending} type="submit">
          {isPending ? "Logging in..." : "Login"}
        </Button>

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
