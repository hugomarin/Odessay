"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { type FormEvent, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  isUsernameFormatValid,
  normalizeEmail,
  normalizeUsername,
  sanitizeRedirectPath,
  toFriendlyAuthError,
  validateSignupValues,
  type AuthFieldErrors,
} from "@/lib/auth/validation"
import { webAuthService } from "@/lib/services/web-auth-service"

type UsernameStatus =
  | { state: "idle"; message: string | null }
  | { state: "checking"; message: string }
  | { state: "available"; message: string }
  | { state: "unavailable"; message: string }

export function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefilledEmail = searchParams.get("email") ?? ""
  const lockEmail = searchParams.get("lockEmail") === "1"
  const redirectTo = useMemo(
    () => sanitizeRedirectPath(searchParams.get("next")),
    [searchParams],
  )

  const [displayName, setDisplayName] = useState("")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState(prefilledEmail)
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<AuthFieldErrors>({})
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>({
    state: "idle",
    message: null,
  })
  const [isPending, startTransition] = useTransition()

  const deferredUsername = useDeferredValue(username)
  const normalizedUsername = normalizeUsername(deferredUsername)
  const usernameFormatValid =
    normalizedUsername.length === 0 || isUsernameFormatValid(normalizedUsername)

  useEffect(() => {
    if (!normalizedUsername) {
      setUsernameStatus({ state: "idle", message: null })
      return
    }

    if (!usernameFormatValid) {
      setUsernameStatus({
        state: "unavailable",
        message: "Use 3-32 lowercase letters, numbers, or underscores.",
      })
      return
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      setUsernameStatus({ state: "checking", message: "Checking username..." })

      try {
        const result = await webAuthService.checkUsernameAvailability({
          username: normalizedUsername,
          scope: "signup",
        })

        if (controller.signal.aborted) {
          return
        }

        if (result.error || !result.data) {
          setUsernameStatus({
            state: "unavailable",
            message: "We could not validate this username right now.",
          })
          return
        }

        setUsernameStatus(
          result.data.available
            ? { state: "available", message: "Username is available." }
            : { state: "unavailable", message: "That username is already taken." },
        )
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }

        setUsernameStatus({
          state: "unavailable",
          message: "We could not validate this username right now.",
        })
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [normalizedUsername, usernameFormatValid])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors = validateSignupValues({
      displayName,
      username,
      email,
      password,
    })

    if (usernameStatus.state === "unavailable" || usernameStatus.state === "checking") {
      nextErrors.username = usernameStatus.message ?? "Choose a different username."
    }

    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    startTransition(async () => {
      const result = await webAuthService.signUp({
        displayName,
        username,
        email: normalizeEmail(email),
        password,
        nextPath: "/desk",
      })

      if (result.error) {
        setErrors({ form: toFriendlyAuthError(result.error.message) })
        return
      }

      if (result.data.requiresEmailConfirmation) {
        router.replace(
          `/login?email=${encodeURIComponent(normalizeEmail(email))}&checkEmail=1`,
        )
        router.refresh()
        return
      }

      router.replace(redirectTo)
      router.refresh()
    })
  }

  return (
    <section
      id="signup"
      data-page="signup"
      className="space-y-8"
    >
      <div className="space-y-2">
        <h1 className="font-lora text-[2rem] font-medium leading-[1.18] tracking-[-0.01em] text-ink">
          Create your account
        </h1>
        <p className="max-w-sm text-sm leading-6 text-ink-3">
          Start with a quiet desk, a protected session, and room to write with intention.
        </p>
      </div>

      <form
        id="signup-form"
        data-section="signup-form"
        data-testid="signup-form"
        className="SignupForm space-y-5"
        onSubmit={handleSubmit}
      >
        <div className="space-y-2">
          <label className="text-[13px] font-medium text-ink-2" htmlFor="signup-display-name">
            Display name
          </label>
          <Input
            id="signup-display-name"
            autoComplete="name"
            name="displayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            aria-invalid={Boolean(errors.displayName)}
          />
          <p className="text-[13px] text-ink-4">Name people will see on your profile.</p>
          {errors.displayName ? <p className="text-[13px] text-destructive">{errors.displayName}</p> : null}
        </div>

        <div className="space-y-2">
          <label className="text-[13px] font-medium text-ink-2" htmlFor="signup-username">
            Username
          </label>
          <Input
            id="signup-username"
            autoCapitalize="none"
            autoComplete="username"
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value.toLowerCase())}
            aria-invalid={Boolean(errors.username)}
          />
          <p
            className={
              usernameStatus.state === "available"
                ? "text-[13px] text-[hsl(140,40%,32%)]"
                : usernameStatus.state === "checking"
                  ? "text-[13px] text-ink-4"
                  : errors.username || usernameStatus.state === "unavailable"
                    ? "text-[13px] text-destructive"
                    : "text-[13px] text-ink-4"
            }
          >
            {errors.username ??
              usernameStatus.message ??
              "Unique handle for your profile and links. Use 3-32 lowercase letters, numbers, or underscores."}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-[13px] font-medium text-ink-2" htmlFor="signup-email">
            Email
          </label>
          <Input
            id="signup-email"
            autoComplete="email"
            autoCapitalize="none"
            disabled={lockEmail}
            name="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(errors.email)}
          />
          {errors.email ? <p className="text-[13px] text-destructive">{errors.email}</p> : null}
        </div>

        <div className="space-y-2">
          <label className="text-[13px] font-medium text-ink-2" htmlFor="signup-password">
            Password
          </label>
          <Input
            id="signup-password"
            autoComplete="new-password"
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
          {isPending ? "Creating account..." : "Create account"}
        </Button>

        <p className="text-[13px] text-ink-4">
          Already have an account?{" "}
          <Link className="font-medium text-ink-2 transition-colors hover:text-ink" href="/login">
            Log in
          </Link>
        </p>
      </form>
    </section>
  )
}
