"use client"

import { HardDrive } from "lucide-react"
import Link from "next/link"
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from "react"
import { Eye, EyeOff } from "lucide-react"
import { ArtifactMark } from "@/components/brand/artifact-mark"
import { cn } from "@/lib/utils"

/**
 * The single elevated surface of the auth flow — 440px card on the shell
 * background. Sign in, sign up, forgot and reset all render inside it; none of
 * them gets a page of its own.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  tile
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  /** Defaults to the ink brand tile; reset success swaps in the green one. */
  tile?: ReactNode
}) {
  return (
    <div className="od-auth-card" data-testid="auth-card">
      {tile ?? (
        <span className="od-auth-tile">
          <ArtifactMark size={24} palette="onDark" decorative />
        </span>
      )}
      <h1 className="od-auth-title">{title}</h1>
      {subtitle ? <p className="od-auth-subtitle">{subtitle}</p> : null}
      {children}
    </div>
  )
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string
  hint?: string
  /** Rendered on the label row, right-aligned — e.g. the "Forgot?" link. */
  labelAction?: ReactNode
}

/**
 * Label + 46px input + one inline error line. The error is never a toast and
 * never a bare border: the field keeps its shape and gains a line under it.
 */
export const AuthField = forwardRef<HTMLInputElement, FieldProps>(function AuthField(
  { label, error, hint, labelAction, className, id, ...inputProps },
  ref
) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const errorId = `${fieldId}-error`
  const hintId = `${fieldId}-hint`

  return (
    <label className="flex flex-col gap-[7px]" htmlFor={fieldId}>
      <span className="flex items-baseline justify-between gap-[10px]">
        <span className="od-auth-label">{label}</span>
        {labelAction}
      </span>
      <input
        {...inputProps}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        aria-invalid={error ? true : undefined}
        className={cn("od-auth-input", className)}
        id={fieldId}
        ref={ref}
      />
      {error ? (
        <span className="od-auth-error" id={errorId}>
          {error}
        </span>
      ) : hint ? (
        <span className="od-auth-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </label>
  )
})

/**
 * Password field with the reveal toggle inside it and the progressive hint
 * under it. The reveal state is announced rather than left to the icon alone.
 */
export function AuthPasswordField({
  label,
  value,
  error,
  hint,
  labelAction,
  id,
  ...inputProps
}: Omit<FieldProps, "type"> & { value: string }) {
  const [revealed, setRevealed] = useState(false)
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const errorId = `${fieldId}-error`
  const hintId = `${fieldId}-hint`

  return (
    <label className="flex flex-col gap-[7px]" htmlFor={fieldId}>
      <span className="flex items-baseline justify-between gap-[10px]">
        <span className="od-auth-label">{label}</span>
        {labelAction}
      </span>

      <span className="relative block">
        <input
          {...inputProps}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          aria-invalid={error ? true : undefined}
          className="od-auth-input od-auth-input-password"
          id={fieldId}
          type={revealed ? "text" : "password"}
          value={value}
        />
        <button
          aria-label={revealed ? "Hide password" : "Show password"}
          aria-pressed={revealed}
          className="od-auth-reveal"
          onClick={() => setRevealed((current) => !current)}
          tabIndex={-1}
          type="button"
        >
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </span>

      <span className="sr-only" aria-live="polite">
        {revealed ? "Password shown" : "Password hidden"}
      </span>

      {error ? (
        <span className="od-auth-error" id={errorId}>
          {error}
        </span>
      ) : hint ? (
        <span className="od-auth-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </label>
  )
}

/**
 * The progressive hint of the spec: "Minimum 8 characters." → "4 to go." →
 * "Ready."
 */
export function passwordHint(password: string, minimum = 8) {
  if (password.length === 0) {
    return `Minimum ${minimum} characters.`
  }
  if (password.length < minimum) {
    return `${minimum - password.length} to go.`
  }
  return "Ready."
}

/**
 * "Continue without an account" — a peer of the primary action, not a footnote.
 * It is the local-first promise made visible at the one moment the user decides
 * whether to trust the app, so it never says or implies that leaving the
 * account hides local files.
 */
export function LocalOnlyRow({ href = "/desk" }: { href?: string }) {
  return (
    <Link className="od-auth-local" data-testid="local-only-entry" href={href}>
      <span className="od-auth-local-icon">
        <HardDrive size={17} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="od-auth-local-title">Continue without an account</span>
        <span className="od-auth-local-note">Work locally — nothing leaves this machine.</span>
      </span>
    </Link>
  )
}

export function AuthSwitch({
  prompt,
  label,
  onSwitch
}: {
  prompt: string
  label: string
  onSwitch: () => void
}) {
  return (
    <p className="od-auth-switch">
      {prompt}{" "}
      <button className="od-auth-switch-button" onClick={onSwitch} type="button">
        {label}
      </button>
    </p>
  )
}
