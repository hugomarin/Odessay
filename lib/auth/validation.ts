export const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type LoginValues = {
  email: string
  password: string
}

export type ForgotPasswordValues = {
  email: string
}

export type ResetPasswordValues = {
  password: string
  confirmPassword: string
}

export type SignupValues = {
  displayName: string
  username: string
  email: string
  password: string
}

export type AuthFieldErrors = Partial<
  Record<"displayName" | "username" | "email" | "password" | "confirmPassword" | "form", string>
>

export const normalizeEmail = (value: string) => value.trim().toLowerCase()

export const normalizeUsername = (value: string) => value.trim().toLowerCase()

export const sanitizeRedirectPath = (
  candidate: string | null | undefined,
  fallback = "/desk",
) => {
  if (!candidate) {
    return fallback
  }

  if (!candidate.startsWith("/")) {
    return fallback
  }

  if (candidate.startsWith("//")) {
    return fallback
  }

  if (candidate.includes("://")) {
    return fallback
  }

  return candidate
}

export const isUsernameFormatValid = (value: string) =>
  USERNAME_PATTERN.test(normalizeUsername(value))

export const validateLoginValues = (values: LoginValues): AuthFieldErrors => {
  const errors: AuthFieldErrors = {}

  if (!EMAIL_PATTERN.test(normalizeEmail(values.email))) {
    errors.email = "Enter a valid email address."
  }

  if (values.password.trim().length < 8) {
    errors.password = "Password must be at least 8 characters."
  }

  return errors
}

export const validateForgotPasswordValues = (
  values: ForgotPasswordValues,
): AuthFieldErrors => {
  const errors: AuthFieldErrors = {}

  if (!EMAIL_PATTERN.test(normalizeEmail(values.email))) {
    errors.email = "Enter a valid email address."
  }

  return errors
}

export const validateResetPasswordValues = (
  values: ResetPasswordValues,
): AuthFieldErrors => {
  const errors: AuthFieldErrors = {}

  if (values.password.trim().length < 8) {
    errors.password = "Password must be at least 8 characters."
  }

  if (!values.confirmPassword.trim()) {
    errors.confirmPassword = "Confirm your new password."
  } else if (values.password !== values.confirmPassword) {
    errors.confirmPassword = "Passwords do not match."
  }

  return errors
}

export const validateSignupValues = (values: SignupValues): AuthFieldErrors => {
  const errors = validateLoginValues(values)

  if (!values.displayName.trim()) {
    errors.displayName = "Display name is required."
  }

  const normalizedUsername = normalizeUsername(values.username)

  if (!normalizedUsername) {
    errors.username = "Username is required."
  } else if (!isUsernameFormatValid(normalizedUsername)) {
    errors.username = "Use 3-32 lowercase letters, numbers, or underscores."
  }

  return errors
}

export const toFriendlyAuthError = (message: string) => {
  const normalizedMessage = message.toLowerCase()

  if (normalizedMessage.includes("invalid login credentials")) {
    return "Email or password is incorrect."
  }

  if (normalizedMessage.includes("user already registered")) {
    return "An account already exists for this email."
  }

  if (normalizedMessage.includes("email_address_invalid")) {
    return "Enter a valid email address from a real domain."
  }

  if (normalizedMessage.includes("rate limit")) {
    return "Signup is temporarily rate-limited. Please wait a moment and try again."
  }

  if (normalizedMessage.includes("password should be at least")) {
    return "Password must be at least 8 characters."
  }

  if (normalizedMessage.includes("unable to validate email address")) {
    return "Enter a valid email address."
  }

  return "Something went wrong. Please try again."
}

const normalizeAppOrigin = (value: string | undefined | null) => {
  const trimmed = value?.trim()
  if (!trimmed || !/^https?:\/\//.test(trimmed)) {
    return null
  }

  return trimmed.replace(/\/$/, "")
}

export const getAuthConfirmRedirectUrl = (origin: string, next: string) => {
  const appOrigin = normalizeAppOrigin(process.env.NEXT_PUBLIC_APP_URL)
  const safeOrigin = appOrigin ?? origin.replace(/\/$/, "")
  const safeNext = sanitizeRedirectPath(next, "/desk")

  return `${safeOrigin}/auth/confirm?next=${encodeURIComponent(safeNext)}`
}

export const getResetPasswordRedirectUrl = (origin: string) =>
  getAuthConfirmRedirectUrl(origin, "/reset-password")
