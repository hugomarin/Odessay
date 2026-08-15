"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  type FormEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition
} from "react"
import {
  AuthCard,
  AuthField,
  AuthPasswordField,
  AuthSwitch,
  LocalOnlyRow,
  passwordHint
} from "@/components/auth/auth-card"
import {
  isUsernameFormatValid,
  normalizeEmail,
  normalizeUsername,
  sanitizeRedirectPath,
  toFriendlyAuthError,
  validateLoginValues,
  validateSignupValues,
  type AuthFieldErrors
} from "@/lib/auth/validation"
import { isTauriRuntime } from "@/lib/runtime/detect"
import { getAuthService } from "@/lib/services/auth-service-factory"

export type CredentialsMode = "signin" | "signup"

const COPY = {
  signin: {
    title: "Back to your desk",
    subtitle: "Sign in to bring back your workspaces, states and types on this machine.",
    cta: "Sign in",
    pending: "Signing in…",
    switchPrompt: "First time here?",
    switchLabel: "Create an account"
  },
  signup: {
    title: "Create your account",
    subtitle:
      "An account keeps your preferences and lets you sync between machines. Your artifacts stay in your own folders.",
    cta: "Create account",
    pending: "Creating account…",
    switchPrompt: "Already have an account?",
    switchLabel: "Sign in"
  }
} as const

type UsernameStatus =
  | { state: "idle"; message: string | null }
  | { state: "checking"; message: string }
  | { state: "available"; message: string }
  | { state: "unavailable"; message: string }

/**
 * Sign in and sign up are one component with a mode switch, matching the
 * prototype. Switching does not navigate: it flips state and rewrites the URL,
 * so nothing remounts and typed values are only cleared where it matters.
 */
export function CredentialsForm({ initialMode }: { initialMode: CredentialsMode }) {
  const router = useRouter()
  const [mode, setMode] = useState<CredentialsMode>(initialMode)
  const isSignUp = mode === "signup"
  const copy = COPY[mode]

  // Static export soft-navigation leaves useSearchParams stale, so the query is
  // read from the live location instead.
  const [search, setSearch] = useState("")
  useEffect(() => {
    setSearch(window.location.search)
  }, [])
  const params = useMemo(() => new URLSearchParams(search), [search])

  const redirectTo = useMemo(() => sanitizeRedirectPath(params.get("next")), [params])
  const needsEmailConfirmation = params.get("checkEmail") === "1"
  const lockEmail = params.get("lockEmail") === "1"

  const [displayName, setDisplayName] = useState("")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState(() => params.get("email") ?? "")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<AuthFieldErrors>({})
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>({ state: "idle", message: null })
  const [isPending, startTransition] = useTransition()

  // Guards the second `⏎` while a request is already in flight.
  const inFlight = useRef(false)

  useEffect(() => {
    const prefill = params.get("email")
    if (prefill) {
      setEmail(prefill)
    }
  }, [params])

  const deferredUsername = useDeferredValue(username)
  const normalizedUsername = normalizeUsername(deferredUsername)
  const usernameFormatValid = normalizedUsername.length === 0 || isUsernameFormatValid(normalizedUsername)

  useEffect(() => {
    if (!isSignUp || !normalizedUsername) {
      setUsernameStatus({ state: "idle", message: null })
      return
    }

    if (!usernameFormatValid) {
      setUsernameStatus({
        state: "unavailable",
        message: "Use 3-32 lowercase letters, numbers, or underscores."
      })
      return
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      setUsernameStatus({ state: "checking", message: "Checking username…" })

      try {
        const result = await getAuthService().checkUsernameAvailability({
          username: normalizedUsername,
          scope: "signup"
        })

        if (controller.signal.aborted) {
          return
        }

        if (result.error || !result.data) {
          setUsernameStatus({
            state: "unavailable",
            message: "We could not validate this username right now."
          })
          return
        }

        setUsernameStatus(
          result.data.available
            ? { state: "available", message: "Username is available." }
            : { state: "unavailable", message: "That username is already taken." }
        )
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }
        setUsernameStatus({
          state: "unavailable",
          message: "We could not validate this username right now."
        })
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [isSignUp, normalizedUsername, usernameFormatValid])

  const switchMode = useCallback(() => {
    const next: CredentialsMode = isSignUp ? "signin" : "signup"
    setMode(next)
    setPassword("")
    setErrors({})
    setUsernameStatus({ state: "idle", message: null })

    // Keep the address bar honest without a navigation: a route change here
    // would remount the card and throw away what the user already typed.
    const path = next === "signup" ? "/signup" : "/login"
    window.history.replaceState(null, "", `${path}${window.location.search}`)
  }, [isSignUp])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (inFlight.current) {
      return
    }

    const nextErrors = isSignUp
      ? validateSignupValues({ displayName, username, email, password })
      : validateLoginValues({ email, password })

    if (isSignUp && (usernameStatus.state === "unavailable" || usernameStatus.state === "checking")) {
      nextErrors.username = usernameStatus.message ?? "Choose a different username."
    }

    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    inFlight.current = true

    startTransition(async () => {
      try {
        if (isSignUp) {
          const result = await getAuthService().signUp({
            displayName,
            username,
            email: normalizeEmail(email),
            password,
            nextPath: redirectTo
          })

          if (result.error) {
            // The typed values survive: only the error line is added.
            setErrors({ form: toFriendlyAuthError(result.error.message) })
            return
          }

          if (result.data.requiresEmailConfirmation) {
            router.replace(
              `/login?email=${encodeURIComponent(normalizeEmail(email))}&checkEmail=1&next=${encodeURIComponent(redirectTo)}`
            )
            router.refresh()
            return
          }
        } else {
          const result = await getAuthService().signIn({
            email: normalizeEmail(email),
            password
          })

          if (result.error) {
            setErrors({ form: toFriendlyAuthError(result.error.message) })
            return
          }
        }

        router.replace(redirectTo)
        if (!isTauriRuntime()) {
          router.refresh()
        }
      } finally {
        // Always releases, so a failed request never leaves a dead button.
        inFlight.current = false
      }
    })
  }

  if (needsEmailConfirmation) {
    return (
      <AuthCard
        subtitle="Open the confirmation link we sent to activate your account, then come back here to sign in."
        title="Check your email"
      >
        <p className="od-auth-hint">
          We sent a confirmation link to {email || "your email address"}.
        </p>
        <LocalOnlyRow href={redirectTo} />
        <p className="od-auth-switch">
          Already confirmed?{" "}
          <Link className="od-auth-switch-button" href="/login">
            Sign in
          </Link>
        </p>
      </AuthCard>
    )
  }

  const usernameHint =
    usernameStatus.message ?? "Your handle for profile and links. 3-32 lowercase letters, numbers or underscores."

  // The prototype keeps the primary inert until the form could plausibly
  // succeed, and paints it #E4E1DC while it is.
  const ready = isSignUp
    ? Boolean(displayName.trim() && username.trim() && email.trim() && password.length >= 8)
    : Boolean(email.trim() && password.length > 0)

  return (
    <AuthCard subtitle={copy.subtitle} title={copy.title}>
      <form
        className="od-auth-fields"
        data-testid={isSignUp ? "signup-form" : "login-form"}
        noValidate
        onSubmit={handleSubmit}
      >
        {isSignUp ? (
          <>
            <AuthField
              autoComplete="name"
              error={errors.displayName}
              id="auth-display-name"
              label="Name"
              name="displayName"
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Hugo Marin"
              value={displayName}
            />
            <AuthField
              autoCapitalize="none"
              autoComplete="username"
              error={errors.username}
              hint={usernameHint}
              id="auth-username"
              label="Username"
              name="username"
              onChange={(event) => setUsername(event.target.value.toLowerCase())}
              placeholder="hugo"
              value={username}
            />
          </>
        ) : null}

        <AuthField
          autoCapitalize="none"
          autoComplete="email"
          disabled={lockEmail}
          error={errors.email}
          id="auth-email"
          label="Email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@domain.com"
          type="email"
          value={email}
        />

        <AuthPasswordField
          autoComplete={isSignUp ? "new-password" : "current-password"}
          error={errors.password}
          hint={isSignUp ? passwordHint(password) : undefined}
          id="auth-password"
          label="Password"
          labelAction={
            !isSignUp ? (
              <Link className="od-auth-switch-button" href="/forgot-password">
                Forgot?
              </Link>
            ) : null
          }
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••"
          value={password}
        />

        {errors.form ? (
          <p className="od-auth-error" role="alert">
            {errors.form}
          </p>
        ) : null}

        <button className="od-auth-primary" disabled={!ready || isPending} type="submit">
          {isPending ? copy.pending : copy.cta}
        </button>
      </form>

      <LocalOnlyRow href={redirectTo} />

      <AuthSwitch label={copy.switchLabel} onSwitch={switchMode} prompt={copy.switchPrompt} />
    </AuthCard>
  )
}
