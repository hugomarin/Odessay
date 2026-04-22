"use client"

import { CheckCircle2, LoaderCircle, Mail, Shield, UserRound } from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  updateDisplayNameSchema,
  updateEmailSchema,
  updatePasswordSchema,
  updateUsernameSchema,
} from "@/lib/validation/account-schemas"

type AccountFormProps = {
  initialAccount: {
    id: string
    email: string
    displayName: string
    username: string
  }
}

type ApiEnvelope<T> = {
  data: T | null
  error: { code: string; message: string } | null
}

type InlineState =
  | { tone: "muted"; message: string }
  | { tone: "success"; message: string }
  | { tone: "error"; message: string }

type UsernameAvailability = {
  available: boolean
  reason: "available" | "current" | "taken" | "reserved"
  reservedUntil: string | null
}

function FieldHint({ state }: { state: InlineState | null }) {
  if (!state) {
    return null
  }

  return (
    <p
      className={cn(
        "text-[13px] leading-6",
        state.tone === "success" && "text-[hsl(140_40%_32%)]",
        state.tone === "error" && "text-destructive",
        state.tone === "muted" && "text-ink-4",
      )}
    >
      {state.message}
    </p>
  )
}

function SaveButton({
  disabled,
  isPending,
  label = "Save changes",
}: {
  disabled: boolean
  isPending: boolean
  label?: string
}) {
  return (
    <Button type="submit" size="lg" disabled={disabled || isPending} className="min-w-[148px]">
      {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
      {label}
    </Button>
  )
}

function SectionCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  children,
}: {
  icon: typeof UserRound
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[22px] border-[0.5px] border-border/80 bg-sb/95 p-6 shadow-float sm:p-7">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-4">{eyebrow}</p>
          <div className="space-y-2">
            <h2 className="font-lora text-[1.85rem] font-medium leading-[1.12] tracking-[-0.02em] text-ink">
              {title}
            </h2>
            <p className="max-w-2xl text-[14px] leading-6 text-ink-3">{description}</p>
          </div>
        </div>

        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[hsl(22_55%_95%)] text-cursor">
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.6} />
        </span>
      </div>

      {children}
    </section>
  )
}

export function AccountForm({ initialAccount }: AccountFormProps) {
  const [displayName, setDisplayName] = useState(initialAccount.displayName)
  const [username, setUsername] = useState(initialAccount.username)
  const [email, setEmail] = useState(initialAccount.email)
  const [savedDisplayName, setSavedDisplayName] = useState(initialAccount.displayName)
  const [savedUsername, setSavedUsername] = useState(initialAccount.username)
  const [savedEmailRequest, setSavedEmailRequest] = useState(initialAccount.email)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  const [displayNameState, setDisplayNameState] = useState<InlineState | null>(null)
  const [usernameState, setUsernameState] = useState<InlineState | null>(null)
  const [emailState, setEmailState] = useState<InlineState | null>(null)
  const [passwordState, setPasswordState] = useState<InlineState | null>(null)

  const [isDisplayNamePending, startDisplayNameTransition] = useTransition()
  const [isUsernamePending, startUsernameTransition] = useTransition()
  const [isEmailPending, startEmailTransition] = useTransition()
  const [isPasswordPending, startPasswordTransition] = useTransition()

  const normalizedUsername = useMemo(
    () => username.trim().toLowerCase(),
    [username],
  )
  const deferredUsername = useDeferredValue(normalizedUsername)
  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email])
  const isDisplayNameDirty = displayName.trim() !== savedDisplayName
  const isUsernameDirty = normalizedUsername !== savedUsername
  const isEmailDirty = normalizedEmail !== savedEmailRequest
  const isPasswordDirty =
    currentPassword.length > 0 || newPassword.length > 0 || confirmPassword.length > 0

  useEffect(() => {
    if (!isUsernameDirty) {
      setUsernameState({
        tone: "muted",
        message: "Your public URL will update after you save a new username.",
      })
      return
    }

    const parsed = updateUsernameSchema.safeParse({ username: deferredUsername })

    if (!parsed.success) {
      setUsernameState({
        tone: "error",
        message: parsed.error.issues[0]?.message ?? "Username format is invalid.",
      })
      return
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/user/update-username?username=${encodeURIComponent(parsed.data.username)}`,
          { signal: controller.signal },
        )
        const payload = (await response.json()) as ApiEnvelope<UsernameAvailability>

        if (!response.ok || !payload.data) {
          setUsernameState({
            tone: "error",
            message: payload.error?.message ?? "We could not validate this username right now.",
          })
          return
        }

        setUsernameState(
          payload.data.available
            ? {
                tone: "success",
                message:
                  payload.data.reason === "current"
                    ? "You are keeping your current username."
                    : "Username is available.",
              }
            : {
                tone: "error",
                message:
                  payload.data.reason === "reserved"
                    ? "That username is temporarily reserved by another account."
                    : "That username is already taken.",
              },
        )
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }

        setUsernameState({
          tone: "error",
          message: "We could not validate this username right now.",
        })
      }
    }, 220)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [deferredUsername, isUsernameDirty])

  const handleDisplayNameSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const parsed = updateDisplayNameSchema.safeParse({ displayName })
    if (!parsed.success) {
      setDisplayNameState({
        tone: "error",
        message: parsed.error.issues[0]?.message ?? "Invalid display name.",
      })
      return
    }

    startDisplayNameTransition(async () => {
      const response = await fetch("/api/user/update-display-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })
      const payload = (await response.json()) as ApiEnvelope<{ displayName: string }>

      if (!response.ok || !payload.data) {
        setDisplayNameState({
          tone: "error",
          message: payload.error?.message ?? "Could not update display name.",
        })
        return
      }

      setDisplayName(payload.data.displayName)
      setSavedDisplayName(payload.data.displayName)
      setDisplayNameState({
        tone: "success",
        message: "Display name updated.",
      })
    })
  }

  const handleUsernameSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const parsed = updateUsernameSchema.safeParse({ username })
    if (!parsed.success) {
      setUsernameState({
        tone: "error",
        message: parsed.error.issues[0]?.message ?? "Invalid username.",
      })
      return
    }

    startUsernameTransition(async () => {
      const response = await fetch("/api/user/update-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })
      const payload = (await response.json()) as ApiEnvelope<{
        username: string
        previousUsername: string
        reservedUntil: string | null
      }>

      if (!response.ok || !payload.data) {
        setUsernameState({
          tone: "error",
          message: payload.error?.message ?? "Could not update username.",
        })
        return
      }

      setUsername(payload.data.username)
      setSavedUsername(payload.data.username)
      setUsernameState({
        tone: "success",
        message:
          payload.data.reservedUntil != null
            ? "Username updated. Your previous handle is reserved for 7 days."
            : "Username updated.",
      })
    })
  }

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const parsed = updateEmailSchema.safeParse({ email })
    if (!parsed.success) {
      setEmailState({
        tone: "error",
        message: parsed.error.issues[0]?.message ?? "Invalid email address.",
      })
      return
    }

    startEmailTransition(async () => {
      const response = await fetch("/api/user/update-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })
      const payload = (await response.json()) as ApiEnvelope<{ email: string }>

      if (!response.ok || !payload.data) {
        setEmailState({
          tone: "error",
          message: payload.error?.message ?? "Could not start email change.",
        })
        return
      }

      setEmail(payload.data.email)
      setSavedEmailRequest(payload.data.email)
      setEmailState({
        tone: "success",
        message: "Confirmation links were sent to your current and new email addresses.",
      })
    })
  }

  const handlePasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const parsed = updatePasswordSchema.safeParse({
      currentPassword,
      newPassword,
      confirmPassword,
    })
    if (!parsed.success) {
      setPasswordState({
        tone: "error",
        message: parsed.error.issues[0]?.message ?? "Could not validate password change.",
      })
      return
    }

    startPasswordTransition(async () => {
      const response = await fetch("/api/user/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      })
      const payload = (await response.json()) as ApiEnvelope<{ revokedOtherSessions: boolean }>

      if (!response.ok || !payload.data) {
        setPasswordState({
          tone: "error",
          message: payload.error?.message ?? "Could not update password.",
        })
        return
      }

      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setPasswordState({
        tone: "success",
        message: payload.data.revokedOtherSessions
          ? "Password updated. Other sessions were revoked."
          : "Password updated.",
      })
    })
  }

  return (
    <div id="settings-account-page" data-page="settings-account-page" className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.72fr)]">
        <SectionCard
          icon={UserRound}
          eyebrow="Public identity"
          title="Profile"
          description="The name and handle attached to your public writing space. Save each field independently with inline confirmation."
        >
          <div
            id="settings-account-identity"
            data-section="settings-account-identity"
            data-testid="settings-account-identity"
            className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]"
          >
            <form
              id="settings-display-name-form"
              data-section="settings-display-name-form"
              data-testid="settings-display-name-form"
              className="space-y-4"
              onSubmit={handleDisplayNameSubmit}
            >
              <div className="space-y-2">
                <label htmlFor="settings-display-name" className="text-[13px] font-medium text-ink-2">
                  Display name
                </label>
                <Input
                  id="settings-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="How your name appears in Odessay"
                  className="h-12 rounded-[14px] px-4 text-[15px]"
                />
              </div>

              <FieldHint
                state={
                  displayNameState ??
                  {
                    tone: "muted",
                    message: "Shown across your public profile and authored writings.",
                  }
                }
              />

              <SaveButton disabled={!isDisplayNameDirty} isPending={isDisplayNamePending} />
            </form>

            <form
              id="settings-username-form"
              data-section="settings-username-form"
              data-testid="settings-username-form"
              className="space-y-4"
              onSubmit={handleUsernameSubmit}
            >
              <div className="space-y-2">
                <label htmlFor="settings-username" className="text-[13px] font-medium text-ink-2">
                  Username
                </label>
                <Input
                  id="settings-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value.toLowerCase())}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="your-public-handle"
                  className="h-12 rounded-[14px] px-4 text-[15px]"
                />
              </div>

              <FieldHint state={usernameState} />

              <SaveButton disabled={!isUsernameDirty || usernameState?.tone === "error"} isPending={isUsernamePending} />
            </form>
          </div>
        </SectionCard>

        <section
          id="settings-account-route-card"
          data-section="settings-account-route-card"
          data-testid="settings-account-route-card"
          className="rounded-[22px] border-[0.5px] border-[hsl(22_28%_84%)] bg-[linear-gradient(180deg,_hsl(22_55%_96%)_0%,_hsl(36_30%_97%)_100%)] p-6 shadow-float sm:p-7"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cursor">Public route</p>
          <div className="mt-4 space-y-4">
            <h2 className="font-lora text-[1.7rem] font-medium leading-[1.12] tracking-[-0.02em] text-ink">
              @{username.trim().toLowerCase() || initialAccount.username}
            </h2>
            <div className="rounded-[18px] border-[0.5px] border-[hsl(22_35%_82%)] bg-sb/80 px-4 py-4">
              <p className="text-[12px] uppercase tracking-[0.14em] text-ink-4">Current address</p>
              <p className="mt-2 break-all text-[14px] leading-6 text-ink-2">
                /{username.trim().toLowerCase() || initialAccount.username}
              </p>
            </div>
            <p className="text-[13px] leading-6 text-[hsl(25_22%_34%)]">
              If you change this handle, your previous one stays reserved to your account for 7 days before it can be claimed elsewhere.
            </p>
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          icon={Mail}
          eyebrow="Secure email"
          title="Email"
          description="Changing your email requires confirmation in both inboxes so the current owner can review or revoke the request."
        >
          <form
            id="settings-email-form"
            data-section="settings-email-form"
            data-testid="settings-email-form"
            className="space-y-4"
            onSubmit={handleEmailSubmit}
          >
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-2">
                <label className="text-[13px] font-medium text-ink-2" htmlFor="settings-current-email">
                  Current email
                </label>
                <Input
                  id="settings-current-email"
                  value={initialAccount.email}
                  disabled
                  className="h-12 rounded-[14px] px-4 text-[15px] text-ink-3"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[13px] font-medium text-ink-2" htmlFor="settings-next-email">
                  New email
                </label>
                <Input
                  id="settings-next-email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoCapitalize="none"
                  className="h-12 rounded-[14px] px-4 text-[15px]"
                />
              </div>
            </div>

            <FieldHint
              state={
                emailState ??
                {
                  tone: "muted",
                  message: "The change completes only after the new inbox confirms the request.",
                }
              }
            />

            <SaveButton disabled={!isEmailDirty} isPending={isEmailPending} label="Send confirmation links" />
          </form>
        </SectionCard>

        <SectionCard
          icon={Shield}
          eyebrow="Credential security"
          title="Password"
          description="Verify your current password first, then rotate to a new one. Existing sessions on other devices are revoked after the change."
        >
          <form
            id="settings-password-form"
            data-section="settings-password-form"
            data-testid="settings-password-form"
            className="space-y-4"
            onSubmit={handlePasswordSubmit}
          >
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-2 md:col-span-2">
                <label className="text-[13px] font-medium text-ink-2" htmlFor="settings-current-password">
                  Current password
                </label>
                <Input
                  id="settings-current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className="h-12 rounded-[14px] px-4 text-[15px]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[13px] font-medium text-ink-2" htmlFor="settings-new-password">
                  New password
                </label>
                <Input
                  id="settings-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="h-12 rounded-[14px] px-4 text-[15px]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[13px] font-medium text-ink-2" htmlFor="settings-confirm-password">
                  Confirm new password
                </label>
                <Input
                  id="settings-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="h-12 rounded-[14px] px-4 text-[15px]"
                />
              </div>
            </div>

            <FieldHint
              state={
                passwordState ??
                {
                  tone: "muted",
                  message: "Use at least 8 characters and avoid reusing the current password.",
                }
              }
            />

            <SaveButton disabled={!isPasswordDirty} isPending={isPasswordPending} label="Update password" />
          </form>
        </SectionCard>
      </div>

      <section
        id="settings-account-status"
        data-section="settings-account-status"
        data-testid="settings-account-status"
        className="rounded-[22px] border-[0.5px] border-border/80 bg-sb/95 px-6 py-5 shadow-float"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-4">Account status</p>
            <p className="text-[14px] leading-6 text-ink-3">
              Save actions stay inline here. No modals, no detours from the writing shell.
            </p>
          </div>

          <div className="inline-flex items-center gap-2 rounded-full bg-[hsl(140_28%_94%)] px-3 py-1.5 text-[12px] font-medium text-[hsl(140_40%_30%)]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Live settings surface ready
          </div>
        </div>
      </section>
    </div>
  )
}
