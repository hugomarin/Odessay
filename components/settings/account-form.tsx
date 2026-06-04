"use client"

import { CheckCircle2, LoaderCircle, Copy } from "lucide-react"
import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getAuthService } from "@/lib/services/auth-service-factory"
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

type InlineState =
  | { tone: "muted"; message: string }
  | { tone: "success"; message: string }
  | { tone: "error"; message: string }

function FieldHint({ state }: { state: InlineState | null }) {
  if (!state) {
    return null
  }

  return (
    <p
      className={cn(
        "text-[12px] leading-5",
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
  label = "Save",
  onClick,
}: {
  disabled: boolean
  isPending: boolean
  label?: string
  onClick?: () => void
}) {
  return (
    <Button
      type={onClick ? "button" : "submit"}
      disabled={disabled || isPending}
      className="h-[32px] px-[14px] text-[13px] font-medium"
      onClick={onClick}
    >
      {isPending ? <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" /> : null}
      {label}
    </Button>
  )
}

function GhostButton({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        "h-[28px] border-[0.5px] border-border px-3 text-[12px] text-ink-3 hover:bg-muted hover:text-ink-2",
        className,
      )}
    >
      {children}
    </Button>
  )
}

function CredRow({
  label,
  status,
  action,
  children,
}: {
  label: string
  status: React.ReactNode
  action: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="border-b-[0.5px] border-border last:border-b-0">
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-4">
          <span className="text-[13px] font-medium text-ink">{label}</span>
          <span className="text-[14px] text-ink-3">{status}</span>
        </div>
        {action}
      </div>
      {children && <div className="border-t-[0.5px] border-border bg-bg px-4 py-4">{children}</div>}
    </div>
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

  const [expandedRow, setExpandedRow] = useState<"email" | "password" | null>(null)
  const [copiedEmail, setCopiedEmail] = useState(false)

  const displayNameFormRef = useRef<HTMLFormElement>(null)
  const usernameFormRef = useRef<HTMLFormElement>(null)

  const normalizedUsername = useMemo(() => username.trim().toLowerCase(), [username])
  const deferredUsername = useDeferredValue(normalizedUsername)
  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email])
  const isDisplayNameDirty = displayName.trim() !== savedDisplayName
  const isUsernameDirty = normalizedUsername !== savedUsername
  const isEmailDirty = normalizedEmail !== savedEmailRequest
  const isPasswordDirty =
    currentPassword.length > 0 || newPassword.length > 0 || confirmPassword.length > 0
  const isProfileDirty = isDisplayNameDirty || isUsernameDirty

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
        const result = await getAuthService().checkUsernameAvailability({
          username: parsed.data.username,
          scope: "account",
        })

        if (controller.signal.aborted) {
          return
        }

        if (result.error || !result.data) {
          setUsernameState({
            tone: "error",
            message: result.error?.message ?? "We could not validate this username right now.",
          })
          return
        }

        setUsernameState(
          result.data.available
            ? {
                tone: "success",
                message:
                  result.data.reason === "current"
                    ? "You are keeping your current username."
                    : "Username is available.",
              }
            : {
                tone: "error",
                message:
                  result.data.reason === "reserved"
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
      const result = await getAuthService().updateDisplayName(parsed.data)

      if (result.error || !result.data) {
        setDisplayNameState({
          tone: "error",
          message: result.error?.message ?? "Could not update display name.",
        })
        return
      }

      const nextDisplayName = result.data.displayName ?? parsed.data.displayName

      setDisplayName(nextDisplayName)
      setSavedDisplayName(nextDisplayName)
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
      const previousUsername = savedUsername
      const result = await getAuthService().updateUsername(parsed.data)

      if (result.error || !result.data) {
        setUsernameState({
          tone: "error",
          message: result.error?.message ?? "Could not update username.",
        })
        return
      }

      const nextUsername = result.data.username ?? parsed.data.username

      setUsername(nextUsername)
      setSavedUsername(nextUsername)
      setUsernameState({
        tone: "success",
        message:
          nextUsername !== previousUsername
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
      const result = await getAuthService().requestEmailChange(parsed.data)

      if (result.error || !result.data) {
        setEmailState({
          tone: "error",
          message: result.error?.message ?? "Could not start email change.",
        })
        return
      }

      const nextEmail = result.data.pendingEmail ?? parsed.data.email

      setEmail(nextEmail)
      setSavedEmailRequest(nextEmail)
      setEmailState({
        tone: "success",
        message: "Confirmation links were sent to your current and new email addresses.",
      })
      setExpandedRow(null)
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
      const result = await getAuthService().updatePassword(parsed.data)

      if (result.error || !result.data) {
        setPasswordState({
          tone: "error",
          message: result.error?.message ?? "Could not update password.",
        })
        return
      }

      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setPasswordState({
        tone: "success",
        message: "Password updated. Other sessions were revoked.",
      })
      setExpandedRow(null)
    })
  }

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(initialAccount.email)
      setCopiedEmail(true)
      window.setTimeout(() => setCopiedEmail(false), 2000)
    } catch {
      // ignore
    }
  }

  const handleProfileSave = () => {
    if (isDisplayNameDirty && displayNameFormRef.current) {
      displayNameFormRef.current.requestSubmit()
    }
    if (isUsernameDirty && usernameFormRef.current) {
      usernameFormRef.current.requestSubmit()
    }
  }

  return (
    <div id="settings-account-page" data-page="settings-account-page" className="space-y-8">
      <h1 className="font-lora text-[24px] font-normal text-ink">Account</h1>

      {/* Profile */}
      <section id="settings-profile" data-section="settings-profile" data-testid="settings-profile">
        <div
          className="mb-6 border-b-[0.5px] border-border pb-3 text-[16px] font-semibold text-ink"
          style={{ marginBottom: "24px", paddingBottom: "12px" }}
        >
          Profile
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <form
            ref={displayNameFormRef}
            id="settings-display-name-form"
            data-section="settings-display-name-form"
            data-testid="settings-display-name-form"
            onSubmit={handleDisplayNameSubmit}
          >
            <div className="space-y-1.5">
              <label htmlFor="settings-display-name" className="text-[13px] font-medium text-ink-2">
                Display name
              </label>
              <Input
                id="settings-display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="How your name appears in Odessay"
                className="h-[34px] rounded-[8px] border-[0.5px] px-3 text-[14px]"
              />
            </div>
          </form>

          <form
            ref={usernameFormRef}
            id="settings-username-form"
            data-section="settings-username-form"
            data-testid="settings-username-form"
            onSubmit={handleUsernameSubmit}
          >
            <div className="space-y-1.5">
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
                className="h-[34px] rounded-[8px] border-[0.5px] px-3 text-[14px]"
              />
            </div>
          </form>
        </div>

        <div className="mt-3 space-y-1">
          <FieldHint state={displayNameState} />
          <div className="flex items-center justify-between">
            <FieldHint
              state={
                usernameState ?? {
                  tone: "muted",
                  message: `odessay.com/${username.trim().toLowerCase() || initialAccount.username}`,
                }
              }
            />
            {isProfileDirty && (
              <SaveButton
                disabled={
                  (isDisplayNameDirty && isDisplayNamePending) ||
                  (isUsernameDirty && isUsernamePending) ||
                  (isUsernameDirty && usernameState?.tone === "error")
                }
                isPending={isDisplayNamePending || isUsernamePending}
                label="Save"
                onClick={handleProfileSave}
              />
            )}
          </div>
        </div>
      </section>

      {/* Sign in */}
      <section id="settings-signin" data-section="settings-signin" data-testid="settings-signin">
        <div className="mb-6 font-lora text-[18px] font-normal text-ink" style={{ marginBottom: "24px" }}>
          Sign in
        </div>

        <div className="overflow-hidden rounded-[10px] border-[0.5px] border-border">
          {/* Email row */}
          <CredRow
            label="Email"
            status={
              <span className="flex items-center gap-2">
                {initialAccount.email}
                <button
                  type="button"
                  onClick={handleCopyEmail}
                  className="inline-flex items-center text-ink-4 hover:text-ink-2"
                  title="Copy email"
                >
                  {copiedEmail ? (
                    <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  ) : (
                    <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                  )}
                </button>
              </span>
            }
            action={
              <GhostButton
                onClick={() =>
                  setExpandedRow(expandedRow === "email" ? null : "email")
                }
              >
                {expandedRow === "email" ? "Cancel" : "Change"}
              </GhostButton>
            }
          >
            {expandedRow === "email" && (
              <form
                id="settings-email-form"
                data-section="settings-email-form"
                data-testid="settings-email-form"
                onSubmit={handleEmailSubmit}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-ink-2" htmlFor="settings-current-email">
                      Current email
                    </label>
                    <Input
                      id="settings-current-email"
                      value={initialAccount.email}
                      disabled
                      className="h-[34px] rounded-[8px] border-[0.5px] px-3 text-[14px] text-ink-3"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-ink-2" htmlFor="settings-next-email">
                      New email
                    </label>
                    <Input
                      id="settings-next-email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoCapitalize="none"
                      className="h-[34px] rounded-[8px] border-[0.5px] px-3 text-[14px]"
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <FieldHint
                    state={
                      emailState ?? {
                        tone: "muted",
                        message: "The change completes only after the new inbox confirms the request.",
                      }
                    }
                  />
                  <div className="flex items-center gap-2">
                    <GhostButton onClick={() => setExpandedRow(null)}>Cancel</GhostButton>
                    <SaveButton
                      disabled={!isEmailDirty}
                      isPending={isEmailPending}
                      label="Send confirmation links"
                    />
                  </div>
                </div>
              </form>
            )}
          </CredRow>

          {/* Password row */}
          <CredRow
            label="Password"
            status="••••••••"
            action={
              <GhostButton
                onClick={() =>
                  setExpandedRow(expandedRow === "password" ? null : "password")
                }
              >
                {expandedRow === "password" ? "Cancel" : "Change"}
              </GhostButton>
            }
          >
            {expandedRow === "password" && (
              <form
                id="settings-password-form"
                data-section="settings-password-form"
                data-testid="settings-password-form"
                onSubmit={handlePasswordSubmit}
              >
                <div className="space-y-4">
                  <div className="max-w-[310px] space-y-1.5">
                    <label className="text-[13px] font-medium text-ink-2" htmlFor="settings-current-password">
                      Current password
                    </label>
                    <Input
                      id="settings-current-password"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      className="h-[34px] rounded-[8px] border-[0.5px] px-3 text-[14px]"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-medium text-ink-2" htmlFor="settings-new-password">
                        New password
                      </label>
                      <Input
                        id="settings-new-password"
                        type="password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        className="h-[34px] rounded-[8px] border-[0.5px] px-3 text-[14px]"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[13px] font-medium text-ink-2" htmlFor="settings-confirm-password">
                        Confirm new password
                      </label>
                      <Input
                        id="settings-confirm-password"
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        className="h-[34px] rounded-[8px] border-[0.5px] px-3 text-[14px]"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <FieldHint
                    state={
                      passwordState ?? {
                        tone: "muted",
                        message: "Use at least 8 characters and avoid reusing the current password.",
                      }
                    }
                  />
                  <div className="flex items-center gap-2">
                    <GhostButton onClick={() => setExpandedRow(null)}>Cancel</GhostButton>
                    <SaveButton
                      disabled={!isPasswordDirty}
                      isPending={isPasswordPending}
                      label="Update password"
                    />
                  </div>
                </div>
              </form>
            )}
          </CredRow>
        </div>
      </section>

      {/* Danger zone */}
      <section
        id="settings-danger-zone"
        data-section="settings-danger-zone"
        data-testid="settings-danger-zone"
        style={{ marginTop: "56px" }}
      >
        <p className="mb-4 text-[12px] font-medium uppercase tracking-[0.07em] text-ink-4">
          DANGER ZONE
        </p>

        <div className="flex items-center justify-between border-t-[0.5px] border-border py-4">
          <div>
            <p className="text-[14px] font-medium text-ink-3">Delete account</p>
            <p className="mt-0.5 text-[13px] text-ink-4">
              Permanently delete your account and all associated writings.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="h-[28px] border-[0.5px] border-[hsl(0_72%_88%)] bg-transparent px-3 text-[12px] text-destructive hover:bg-[hsl(0_72%_97%)]"
            onClick={() => {
              // eslint-disable-next-line no-console
              console.log("Delete account requested — not implemented")
            }}
          >
            Delete account
          </Button>
        </div>
      </section>
    </div>
  )
}
