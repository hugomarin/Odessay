"use client"

import { createDesktopClient } from "@/lib/supabase/desktop-client"
import {
  isUsernameFormatValid,
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
import { err, ok } from "@/lib/services/service-response"

function toServiceError(code: ServiceError["code"], message: string, retryable = false): ServiceError {
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
    return { status: "anonymous", user: null }
  }
  return {
    status: user.new_email ? "pending-email-change" : "authenticated",
    user: mapIdentity(user),
  }
}

export const desktopAuthService: AuthService = {
  async signIn(input: SignInInput): Promise<ServiceResponse<AuthSession>> {
    try {
      const supabase = createDesktopClient()
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

  async signUp(input: SignUpInput): Promise<ServiceResponse<SignUpResult>> {
    try {
      const supabase = createDesktopClient()
      // Deep link redirect for desktop is handled by ODE-220.
      // For now, use a placeholder that will be replaced by the deep link handler.
      const { data, error } = await supabase.auth.signUp({
        email: normalizeEmail(input.email),
        password: input.password,
        options: {
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

  async signOut(): Promise<ServiceResponse<null>> {
    try {
      const supabase = createDesktopClient()
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

  async checkUsernameAvailability(
    input: CheckUsernameAvailabilityInput,
  ): Promise<ServiceResponse<UsernameAvailability>> {
    try {
      const username = normalizeUsername(input.username)

      if (!isUsernameFormatValid(username)) {
        return err(toServiceError("INVALID_INPUT", "Username format is invalid."))
      }

      const supabase = createDesktopClient()
      const { data, error } = await supabase
        .from("public_profiles")
        .select("username")
        .eq("username", username)
        .maybeSingle()

      if (error) {
        return err(toServiceError("UNAVAILABLE", "Could not validate this username right now.", true))
      }

      return ok<UsernameAvailability>({
        available: !data,
        reason: !data ? "available" : "taken",
        reservedUntil: null,
        username,
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

  async getSession(): Promise<ServiceResponse<AuthSession>> {
    try {
      const supabase = createDesktopClient()
      const { data, error } = await supabase.auth.getUser()

      if (error) {
        return err(toServiceError("UNAVAILABLE", error.message, true))
      }

      return ok(sessionFromUser(data.user))
    } catch (error) {
      return err(
        toServiceError(
          "UNAVAILABLE",
          error instanceof Error ? error.message : "Could not read the current session.",
          true,
        ),
      )
    }
  },

  async updateDisplayName(input: UpdateDisplayNameInput): Promise<ServiceResponse<AccountIdentity>> {
    try {
      const supabase = createDesktopClient()
      const { data, error } = await supabase.auth.updateUser({
        data: { display_name: input.displayName.trim() },
      })

      if (error) {
        return err(toServiceError("UNAVAILABLE", error.message, true))
      }

      if (!data.user) {
        return err(toServiceError("UNAUTHORIZED", "No active session."))
      }

      return ok(mapIdentity(data.user))
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

  async updateUsername(input: UpdateUsernameInput): Promise<ServiceResponse<AccountIdentity>> {
    try {
      const username = normalizeUsername(input.username)
      const supabase = createDesktopClient()
      const { data, error } = await supabase.auth.updateUser({
        data: { username },
      })

      if (error) {
        return err(toServiceError("UNAVAILABLE", error.message, true))
      }

      if (!data.user) {
        return err(toServiceError("UNAUTHORIZED", "No active session."))
      }

      return ok(mapIdentity(data.user))
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

  // Email change redirect URL will be wired via deep links in ODE-220.
  async requestEmailChange(input: RequestEmailChangeInput): Promise<ServiceResponse<AccountIdentity>> {
    try {
      const supabase = createDesktopClient()
      const { data, error } = await supabase.auth.updateUser({
        email: normalizeEmail(input.email),
      })

      if (error) {
        return err(toServiceError("UNAVAILABLE", error.message, true))
      }

      if (!data.user) {
        return err(toServiceError("UNAUTHORIZED", "No active session."))
      }

      return ok(mapIdentity(data.user))
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

  async updatePassword(input: UpdatePasswordInput): Promise<ServiceResponse<AccountIdentity>> {
    try {
      const supabase = createDesktopClient()
      const { data, error } = await supabase.auth.updateUser({
        password: input.newPassword,
      })

      if (error) {
        return err(toServiceError("UNAVAILABLE", error.message, true))
      }

      if (!data.user) {
        return err(toServiceError("UNAUTHORIZED", "No active session."))
      }

      return ok(mapIdentity(data.user))
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
