import {
  PHASE_4_REQUIRED_DOCS,
  SERVICE_RESPONSE_ENVELOPE,
  type ServiceContractDescriptor,
  type ServiceResponse,
} from "./service-types"

export type AccountIdentity = {
  id: string
  email: string | null
  pendingEmail: string | null
  emailConfirmedAt: string | null
  displayName: string | null
  username: string | null
}

export type AuthSession = {
  status: "anonymous" | "authenticated" | "pending-email-change"
  user: AccountIdentity | null
}

export type SignInInput = {
  email: string
  password: string
}

export type SignUpInput = {
  displayName: string
  username: string
  email: string
  password: string
  nextPath?: string
}

export type SignUpResult = {
  session: AuthSession
  requiresEmailConfirmation: boolean
}

export type UsernameAvailability = {
  available: boolean
  reason: "available" | "current" | "taken" | "reserved"
  reservedUntil: string | null
  username: string
}

export type CheckUsernameAvailabilityInput = {
  username: string
  scope?: "signup" | "account"
}

export type UpdateDisplayNameInput = {
  displayName: string
}

export type UpdateUsernameInput = {
  username: string
}

export type RequestEmailChangeInput = {
  email: string
  redirectTo?: string
}

export type UpdatePasswordInput = {
  currentPassword?: string
  newPassword: string
}

export interface AuthService {
  signIn(input: SignInInput): Promise<ServiceResponse<AuthSession>>
  signUp(input: SignUpInput): Promise<ServiceResponse<SignUpResult>>
  signOut(): Promise<ServiceResponse<null>>
  checkUsernameAvailability(input: CheckUsernameAvailabilityInput): Promise<ServiceResponse<UsernameAvailability>>
  getSession(): Promise<ServiceResponse<AuthSession>>
  updateDisplayName(input: UpdateDisplayNameInput): Promise<ServiceResponse<AccountIdentity>>
  updateUsername(input: UpdateUsernameInput): Promise<ServiceResponse<AccountIdentity>>
  requestEmailChange(input: RequestEmailChangeInput): Promise<ServiceResponse<AccountIdentity>>
  updatePassword(input: UpdatePasswordInput): Promise<ServiceResponse<AccountIdentity>>
}

export const AUTH_SERVICE_CONTRACT = {
  name: "AuthService",
  summary:
    "Remote capability boundary for session awareness and account mutations so product flows stop depending directly on Supabase Auth and Next session wiring.",
  responsibilities: [
    "Represent auth/session state as a product capability instead of a hardcoded web runtime precondition.",
    "Expose account mutations through stable inputs/outputs that do not leak provider-specific APIs.",
    "Keep redirect URLs, cookie/session transport, and secret storage details inside runtime adapters.",
  ],
  layer: ["application", "adapter"],
  runtimeScope: ["shared-core", "web", "cloud", "desktop"],
  owner: "architecture-first",
  invariants: [
    "AuthService returns explicit anonymous/authenticated state and does not force callers to infer it from thrown transport errors.",
    "Profile and credential mutations are account capabilities; Supabase session mechanics remain adapter details.",
    "Desktop may implement only a subset initially, but missing capabilities must surface as contract-level UNAVAILABLE or UNSUPPORTED outcomes.",
  ],
  errorEnvelope: SERVICE_RESPONSE_ENVELOPE,
  operations: [
    {
      name: "signIn",
      kind: "command",
      summary: "Authenticate with the active web auth adapter without exposing provider SDK details to the UI.",
      input: ["email", "password"],
      output: ["AuthSession"],
      errorCodes: ["UNAUTHORIZED", "INVALID_INPUT", "UNAVAILABLE", "UNKNOWN"],
    },
    {
      name: "signUp",
      kind: "command",
      summary: "Create an account and report whether email confirmation is still required.",
      input: ["displayName", "username", "email", "password", "optional nextPath"],
      output: ["SignUpResult"],
      errorCodes: ["INVALID_INPUT", "CONFLICT", "UNAVAILABLE", "UNKNOWN"],
    },
    {
      name: "signOut",
      kind: "command",
      summary: "Close the active session through the current runtime adapter.",
      input: ["none"],
      output: ["null"],
      errorCodes: ["SIGNOUT_INCOMPLETE", "UNAVAILABLE", "UNKNOWN"],
    },
    {
      name: "checkUsernameAvailability",
      kind: "query",
      summary: "Validate username availability for signup or authenticated account flows.",
      input: ["username", "optional scope"],
      output: ["UsernameAvailability"],
      errorCodes: ["INVALID_INPUT", "UNAUTHORIZED", "UNAVAILABLE", "UNKNOWN"],
    },
    {
      name: "getSession",
      kind: "session",
      summary: "Resolve the active session and normalized account identity.",
      input: ["none"],
      output: ["AuthSession"],
      errorCodes: ["UNAVAILABLE", "UNKNOWN"],
    },
    {
      name: "updateDisplayName",
      kind: "command",
      summary: "Update the account display name through the active auth/account adapter.",
      input: ["displayName"],
      output: ["AccountIdentity"],
      errorCodes: ["UNAUTHORIZED", "INVALID_INPUT", "DB_ERROR", "UNAVAILABLE"],
    },
    {
      name: "updateUsername",
      kind: "command",
      summary: "Update the account username through the active auth/account adapter.",
      input: ["username"],
      output: ["AccountIdentity"],
      errorCodes: ["UNAUTHORIZED", "INVALID_INPUT", "CONFLICT", "DB_ERROR", "UNAVAILABLE"],
    },
    {
      name: "requestEmailChange",
      kind: "command",
      summary: "Start an email-change flow while keeping redirect/session semantics out of the caller.",
      input: ["email", "optional redirectTo"],
      output: ["AccountIdentity"],
      errorCodes: ["UNAUTHORIZED", "INVALID_INPUT", "CONFLICT", "UNAVAILABLE"],
    },
    {
      name: "updatePassword",
      kind: "command",
      summary: "Rotate the current user's password through the active credentials adapter.",
      input: ["newPassword", "optional currentPassword"],
      output: ["AccountIdentity"],
      errorCodes: ["UNAUTHORIZED", "INVALID_INPUT", "FORBIDDEN", "UNAVAILABLE"],
    },
  ],
  hotspots: [
    {
      id: "supabase-session-coupling",
      summary: "Session entry points still depend directly on browser Supabase auth APIs and Next server helpers.",
      layer: ["application", "adapter"],
      runtimeScope: ["web", "cloud", "shared-core"],
      owner: "architecture-first",
      currentEntrypoints: [
        "lib/supabase/server.ts",
        "lib/supabase/middleware.ts",
        "components/auth/login-form.tsx",
        "components/auth/signup-form.tsx",
        "components/auth/sign-out-button.tsx",
      ],
    },
    {
      id: "account-settings-mutations",
      summary: "Account updates are exposed as individual web routes with provider-specific mutation logic.",
      layer: ["application", "adapter"],
      runtimeScope: ["web", "cloud", "shared-core"],
      owner: "architecture-first",
      currentEntrypoints: [
        "app/api/user/update-display-name/route.ts",
        "app/api/user/update-email/route.ts",
        "app/api/user/update-password/route.ts",
        "app/api/user/update-username/route.ts",
        "components/settings/account-form.tsx",
      ],
    },
    {
      id: "username-availability",
      summary: "Username validation still leaks direct route knowledge into signup and account settings surfaces.",
      layer: ["application", "adapter"],
      runtimeScope: ["web", "shared-core"],
      owner: "architecture-first",
      currentEntrypoints: [
        "app/api/auth/username/route.ts",
        "components/auth/signup-form.tsx",
        "components/settings/account-form.tsx",
      ],
    },
  ],
  requiredDocs: [...PHASE_4_REQUIRED_DOCS],
} satisfies ServiceContractDescriptor<"AuthService", keyof AuthService>
