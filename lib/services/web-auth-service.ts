"use client"

import { createClient } from "@/lib/supabase/client"
import {
  getAuthConfirmRedirectUrl,
  normalizeEmail,
  normalizeUsername,
} from "@/lib/auth/validation"
import type {
  AccountIdentity,
  AuthService,
  AuthSession,
  CheckUsernameAvailabilityInput,
  RequestEmailChangeInput,
  SignInInput,
  SignUpInput,
  SignUpResult,
  UpdateDisplayNameInput,
  UpdatePasswordInput,
  UpdateUsernameInput,
  UsernameAvailability,
} from "@/lib/services/contracts/auth-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import { err, ok, parseServiceEnvelope } from "@/lib/services/service-response"

type UsernameAvailabilityPayload = {
  available: boolean
  reason?: UsernameAvailability["reason"]
  reservedUntil?: string | null
  username?: string
}

type AccountMutationEnvelope = {
  displayName?: string
  username?: string
  email?: string
  previousUsername?: string
  reservedUntil?: string | null
  revokedOtherSessions?: boolean
}

function toServiceError(code: ServiceError["code"], message: string, retryable = false) {
  return { code, message, retryable }
}

function mapIdentity(user: {
  id: string
  email?: string | null
  new_email?: string | null
  email_confirmed_at?: string | null
  user_metadata?: Record<string, unknown>
}): AccountIdentity {
  return {
    id: user.id,
    email: user.email ?? null,
    pendingEmail: user.new_email ?? null,
    emailConfirmedAt: user.email_confirmed_at ?? null,
    displayName:
      typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name : null,
    username:
      typeof user.user_metadata?.username === "string" ? user.user_metadata.username : null,
  }
}

function sessionFromUser(user: {
  id: string
  email?: string | null
  new_email?: string | null
  email_confirmed_at?: string | null
  user_metadata?: Record<string, unknown>
} | null): AuthSession {
  if (!user) {
    return {
      status: "anonymous",
      user: null,
    }
  }

  return {
    status: user.new_email ? "pending-email-change" : "authenticated",
    user: mapIdentity(user),
  }
}

async function loadCurrentSession() {
  const supabase = createClient()
  const { data, error } = await supabase.auth.getUser()

  if (error) {
    return err<AuthSession>(toServiceError("UNAVAILABLE", error.message, true))
  }

  return ok(sessionFromUser(data.user))
}

async function loadCurrentIdentity() {
  const session = await loadCurrentSession()
  if (session.error) {
    return null
  }

  return session.data.user
}

function mergeIdentity(
  base: AccountIdentity | null,
  updates: Partial<AccountIdentity>,
): AccountIdentity {
  return {
    id: base?.id ?? "unknown",
    email: updates.email ?? base?.email ?? null,
    pendingEmail: updates.pendingEmail ?? base?.pendingEmail ?? null,
    emailConfirmedAt: updates.emailConfirmedAt ?? base?.emailConfirmedAt ?? null,
    displayName: updates.displayName ?? base?.displayName ?? null,
    username: updates.username ?? base?.username ?? null,
  }
}

async function parseAccountMutation(
  response: Response,
  fallbackMessage: string,
): Promise<ServiceResponse<AccountMutationEnvelope>> {
  return parseServiceEnvelope<AccountMutationEnvelope>(response, "UNAVAILABLE", fallbackMessage)
}

export const webAuthService: AuthService = {
  async signIn(input: SignInInput) {
    try {
      const supabase = createClient()
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizeEmail(input.email),
        password: input.password,
      })

      if (error) {
        return err(toServiceError("UNAUTHORIZED", error.message))
      }

      return ok(sessionFromUser(data.user))
    } catch (error) {
      return err(
        toServiceError(
          "UNAVAILABLE",
          error instanceof Error ? error.message : "Could not sign in right now.",
          true,
        ),
      )
    }
  },

  async signUp(input: SignUpInput) {
    try {
      const supabase = createClient()
      const nextPath = input.nextPath ?? "/desk"
      const { data, error } = await supabase.auth.signUp({
        email: normalizeEmail(input.email),
        password: input.password,
        options: {
          emailRedirectTo: getAuthConfirmRedirectUrl(window.location.origin, nextPath),
          data: {
            display_name: input.displayName.trim(),
            username: normalizeUsername(input.username),
          },
        },
      })

      if (error) {
        return err(toServiceError("CONFLICT", error.message))
      }

      return ok<SignUpResult>({
        session: sessionFromUser(data.user),
        requiresEmailConfirmation: !data.session,
      })
    } catch (error) {
      return err(
        toServiceError(
          "UNAVAILABLE",
          error instanceof Error ? error.message : "Could not create the account right now.",
          true,
        ),
      )
    }
  },

  async signOut() {
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signOut()

      if (error) {
        return err(toServiceError("UNAVAILABLE", error.message, true))
      }

      return ok(null)
    } catch (error) {
      return err(
        toServiceError(
          "UNAVAILABLE",
          error instanceof Error ? error.message : "Could not sign out right now.",
          true,
        ),
      )
    }
  },

  async checkUsernameAvailability(input: CheckUsernameAvailabilityInput) {
    try {
      const url =
        input.scope === "account"
          ? `/api/user/update-username?username=${encodeURIComponent(input.username)}`
          : `/api/auth/username?value=${encodeURIComponent(input.username)}`

      const response = await fetch(url)
      const parsed = await parseServiceEnvelope<UsernameAvailabilityPayload>(
        response,
        input.scope === "account" ? "UNAUTHORIZED" : "UNAVAILABLE",
        "Could not validate this username right now.",
      )

      if (parsed.error) {
        return parsed
      }

      return ok<UsernameAvailability>({
        available: parsed.data.available,
        reason:
          parsed.data.reason ??
          (parsed.data.available ? "available" : "taken"),
        reservedUntil: parsed.data.reservedUntil ?? null,
        username: parsed.data.username ?? normalizeUsername(input.username),
      })
    } catch (error) {
      return err(
        toServiceError(
          "UNAVAILABLE",
          error instanceof Error ? error.message : "Could not validate this username right now.",
          true,
        ),
      )
    }
  },

  getSession() {
    return loadCurrentSession()
  },

  async updateDisplayName(input: UpdateDisplayNameInput) {
    try {
      const response = await fetch("/api/user/update-display-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      const parsed = await parseAccountMutation(response, "Could not update display name.")
      if (parsed.error) {
        return parsed
      }

      const current = await loadCurrentIdentity()
      return ok(
        mergeIdentity(current, {
          displayName: parsed.data.displayName ?? input.displayName,
        }),
      )
    } catch (error) {
      return err(
        toServiceError(
          "UNAVAILABLE",
          error instanceof Error ? error.message : "Could not update display name.",
          true,
        ),
      )
    }
  },

  async updateUsername(input: UpdateUsernameInput) {
    try {
      const response = await fetch("/api/user/update-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      const parsed = await parseAccountMutation(response, "Could not update username.")
      if (parsed.error) {
        return parsed
      }

      const current = await loadCurrentIdentity()
      return ok(
        mergeIdentity(current, {
          username: parsed.data.username ?? input.username,
        }),
      )
    } catch (error) {
      return err(
        toServiceError(
          "UNAVAILABLE",
          error instanceof Error ? error.message : "Could not update username.",
          true,
        ),
      )
    }
  },

  async requestEmailChange(input: RequestEmailChangeInput) {
    try {
      const response = await fetch("/api/user/update-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      const parsed = await parseAccountMutation(response, "Could not start email change.")
      if (parsed.error) {
        return parsed
      }

      const current = await loadCurrentIdentity()
      return ok(
        mergeIdentity(current, {
          pendingEmail: parsed.data.email ?? input.email,
        }),
      )
    } catch (error) {
      return err(
        toServiceError(
          "UNAVAILABLE",
          error instanceof Error ? error.message : "Could not start email change.",
          true,
        ),
      )
    }
  },

  async updatePassword(input: UpdatePasswordInput) {
    try {
      const response = await fetch("/api/user/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      const parsed = await parseAccountMutation(response, "Could not update password.")
      if (parsed.error) {
        return parsed
      }

      const current = await loadCurrentIdentity()

      if (!current) {
        return err(toServiceError("UNAUTHORIZED", "No active session."))
      }

      return ok(current)
    } catch (error) {
      return err(
        toServiceError(
          "UNAVAILABLE",
          error instanceof Error ? error.message : "Could not update password.",
          true,
        ),
      )
    }
  },
}
