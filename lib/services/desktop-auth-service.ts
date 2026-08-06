"use client"

import { createDesktopClient } from "@/lib/supabase/desktop-client"
import { keychainStorage } from "@/lib/auth/secure-storage"
import { getAccountEmailChangeRedirectUrl, verifyCurrentPassword } from "@/lib/auth/account-settings"
import { resolveUsernameAvailability } from "@/lib/auth/username-validation"
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

let inFlightSessionRequest: Promise<ServiceResponse<AuthSession>> | null = null

// Duck-typed over @supabase/auth-js error classes (AuthSessionMissingError,
// AuthApiError) so the adapter does not depend on SDK internals: only a
// missing stored session or a server-side rejection of the token (401/403)
// is real evidence of "no session".
function isNoSessionError(error: { name?: unknown; status?: unknown }): boolean {
  if (error.name === "AuthSessionMissingError") return true
  if (error.name === "AuthApiError" && (error.status === 401 || error.status === 403)) return true
  return false
}

// Reads the session persisted by the desktop client (Keychain) without any
// network call — unlike supabase.auth.getSession(), which may attempt a
// token refresh when the access token is expired. Used to recover the local
// identity when the server cannot verify the session (offline).
async function readStoredSessionUser(
  supabase: unknown,
): Promise<Parameters<typeof mapIdentity>[0] | null> {
  try {
    const storageKey = (supabase as { storageKey?: string }).storageKey
    if (!storageKey) return null
    const raw = await keychainStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { user?: Parameters<typeof mapIdentity>[0] | null }
    const user = parsed?.user
    if (!user || typeof user.id !== "string") return null
    return user
  } catch {
    return null
  }
}

async function checkDesktopUsernameAvailability(
  input: CheckUsernameAvailabilityInput,
): Promise<ServiceResponse<UsernameAvailability>> {
  const username = normalizeUsername(input.username)

  if (!isUsernameFormatValid(username)) {
    return err(toServiceError("INVALID_INPUT", "Username format is invalid."))
  }

  const supabase = createDesktopClient()
  let currentUserId: string | null = null
  let currentUsername: string | null = null

  if (input.scope === "account") {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError) {
      return err(toServiceError("UNAVAILABLE", userError.message, true))
    }

    if (!user) {
      return err(toServiceError("UNAUTHORIZED", "No active session."))
    }

    currentUserId = user.id

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle()

    if (profileError) {
      return err(toServiceError("UNAVAILABLE", "Could not validate this username right now.", true))
    }

    currentUsername = profile?.username ?? null
  }

  const { data, error } = await supabase
    .from("public_profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle()

  if (error) {
    return err(toServiceError("UNAVAILABLE", "Could not validate this username right now.", true))
  }

  return ok<UsernameAvailability>(
    resolveUsernameAvailability({
      requestedUsername: username,
      currentUserId,
      currentUsername,
      matchingProfileId: data?.id ?? null,
    }),
  )
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

      // Wait for Supabase to flush the session to Keychain (async storage)
      // before returning. Otherwise router.replace("/desk") fires while the
      // setItem promise is still in flight, DesktopAppShell mounts on /desk,
      // its getSession() resolves null, and bounces the user back to /login.
      await new Promise<void>((resolve) => {
        let unsubscribe: (() => void) | null = null
        const timeout = setTimeout(() => {
          unsubscribe?.()
          resolve()
        }, 3000)
        const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
          if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
            clearTimeout(timeout)
            sub.subscription.unsubscribe()
            resolve()
          }
        })
        unsubscribe = () => sub.subscription.unsubscribe()
      })

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
      const { data, error } = await supabase.auth.signUp({
        email: normalizeEmail(input.email),
        password: input.password,
        options: {
          emailRedirectTo: getAccountEmailChangeRedirectUrl(input.nextPath ?? "/desk"),
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

      // Race with timeout to avoid indefinite hang if the network request or
      // storage plugin stalls (ODE-238). The storage adapter already has its
      // own timeout and never blocks, so this catches the server call phase.
      const signOutPromise = supabase.auth.signOut()
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("signOut timeout")), 5000),
      )

      try {
        await Promise.race([signOutPromise, timeoutPromise])
      } catch (raceError) {
        if (raceError instanceof Error && raceError.message === "signOut timeout") {
          // Clear local session regardless of server result so the user is
          // not left with a valid local token. The server revocation may
          // still be in-flight — report that to the caller.
          const storageKey = (supabase as unknown as { storageKey: string }).storageKey
          await keychainStorage.removeItem(storageKey)
          await keychainStorage.removeItem(`${storageKey}-code-verifier`)
          return err(
            toServiceError(
              "SIGNOUT_INCOMPLETE",
              "Sign out timed out. Your local session was cleared, but the remote session may still be active.",
            ),
          )
        }
        throw raceError
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
      return await checkDesktopUsernameAvailability(input)
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

  getSession(): Promise<ServiceResponse<AuthSession>> {
    if (inFlightSessionRequest) {
      return inFlightSessionRequest
    }

    const request = (async (): Promise<ServiceResponse<AuthSession>> => {
      try {
        const supabase = createDesktopClient()
        const { data, error } = await supabase.auth.getUser()

        if (!error) {
          return ok(sessionFromUser(data.user))
        }

        // A missing stored session or a server-side token rejection (401/403)
        // is the only real evidence of "no session" — only this justifies a
        // login redirect downstream.
        if (isNoSessionError(error)) {
          return ok<AuthSession>({ status: "anonymous", user: null })
        }

        // Transport or 5xx failure (offline, server down): the session could
        // not be verified, which is NOT proof that it does not exist. Fall
        // back to the locally stored identity so the app keeps working with
        // local data and no consumer mistakes this for a sign-out (ODE-416).
        const storedUser = await readStoredSessionUser(supabase)
        if (storedUser) {
          return ok<AuthSession>({ status: "unverified", user: mapIdentity(storedUser) })
        }

        return err(toServiceError("UNAVAILABLE", error.message, true))
      } catch (error) {
        return err(
          toServiceError(
            "UNAVAILABLE",
            error instanceof Error ? error.message : "Could not read the current session.",
            true,
          ),
        )
      }
    })()

    inFlightSessionRequest = request
    void request.finally(() => {
      if (inFlightSessionRequest === request) {
        inFlightSessionRequest = null
      }
    })
    return request
  },

  async updateDisplayName(input: UpdateDisplayNameInput): Promise<ServiceResponse<AccountIdentity>> {
    try {
      const supabase = createDesktopClient()
      const displayName = input.displayName.trim()
      const { data, error } = await supabase.auth.updateUser({
        data: { display_name: displayName },
      })

      if (error) {
        return err(toServiceError("UNAVAILABLE", error.message, true))
      }

      if (!data.user) {
        return err(toServiceError("UNAUTHORIZED", "No active session."))
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          display_name: displayName,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.user.id)
        .select("id")
        .single()

      if (profileError) {
        return err(toServiceError("DB_ERROR", profileError.message, true))
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
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) {
        return err(toServiceError("UNAVAILABLE", userError.message, true))
      }

      if (!user) {
        return err(toServiceError("UNAUTHORIZED", "No active session."))
      }

      const availability = await checkDesktopUsernameAvailability({
        username,
        scope: "account",
      })

      if (availability.error || !availability.data) {
        return availability
      }

      if (!availability.data.available) {
        return err(
          toServiceError(
            "CONFLICT",
            availability.data.reason === "reserved"
              ? "That username is temporarily reserved by another account."
              : "That username is already taken.",
          ),
        )
      }

      const { data: claimResult, error: claimError } = await supabase.rpc("claim_profile_username", {
        target_username: username,
      })

      if (claimError) {
        if (claimError.message.includes("USERNAME_RESERVED")) {
          return err(
            toServiceError(
              "CONFLICT",
              "That username is temporarily reserved by another account.",
            ),
          )
        }

        if (claimError.message.includes("USERNAME_TAKEN")) {
          return err(toServiceError("CONFLICT", "That username is already taken."))
        }

        if (claimError.message.includes("INVALID_USERNAME")) {
          return err(toServiceError("INVALID_INPUT", "Username format is invalid."))
        }

        return err(toServiceError("DB_ERROR", claimError.message, true))
      }

      const row = Array.isArray(claimResult) ? claimResult[0] : claimResult
      const nextUsername =
        row && typeof row === "object" && "username" in row && typeof row.username === "string"
          ? row.username
          : username

      const { data, error } = await supabase.auth.updateUser({
        data: { username: nextUsername },
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

  async requestEmailChange(input: RequestEmailChangeInput): Promise<ServiceResponse<AccountIdentity>> {
    try {
      const supabase = createDesktopClient()
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) {
        return err(toServiceError("UNAVAILABLE", userError.message, true))
      }

      if (!user?.email) {
        return err(toServiceError("UNAUTHORIZED", "No active session."))
      }

      if (!user.email_confirmed_at) {
        return err(
          toServiceError(
            "CONFLICT",
            "Confirm your current email before requesting another change.",
          ),
        )
      }

      if (user.new_email) {
        return err(
          toServiceError(
            "CONFLICT",
            "You already have a pending email change. Confirm or revoke it from your inbox first.",
          ),
        )
      }

      const nextEmail = normalizeEmail(input.email)

      if (nextEmail === normalizeEmail(user.email)) {
        return err(toServiceError("INVALID_INPUT", "Use a different email address."))
      }

      const { data, error } = await supabase.auth.updateUser(
        { email: nextEmail },
        { emailRedirectTo: getAccountEmailChangeRedirectUrl(input.redirectTo) },
      )

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
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) {
        return err(toServiceError("UNAVAILABLE", userError.message, true))
      }

      if (!user?.email) {
        return err(toServiceError("UNAUTHORIZED", "No active session."))
      }

      if (!input.currentPassword || input.currentPassword.trim() === "") {
        return err(toServiceError("INVALID_INPUT", "Current password is required."))
      }

      const isCurrentPasswordValid = await verifyCurrentPassword(user.email, input.currentPassword)

      if (!isCurrentPasswordValid) {
        return err(toServiceError("FORBIDDEN", "Your current password is incorrect."))
      }

      const { data, error } = await supabase.auth.updateUser({
        password: input.newPassword,
      })

      if (error) {
        return err(toServiceError("UNAVAILABLE", error.message, true))
      }

      if (!data.user) {
        return err(toServiceError("UNAUTHORIZED", "No active session."))
      }

      const { error: revokeError } = await supabase.auth.signOut({ scope: "others" })

      if (revokeError) {
        console.error("[desktop-auth-service:update-password:revoke]", revokeError)
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
