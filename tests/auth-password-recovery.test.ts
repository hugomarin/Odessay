import { describe, expect, it } from "vitest"
import {
  getAuthConfirmRedirectUrl,
  getResetPasswordRedirectUrl,
  normalizeEmail,
  validateForgotPasswordValues,
  validateResetPasswordValues,
} from "@/lib/auth/validation"

describe("password recovery validation", () => {
  it("normalizes the recovery email without exposing account existence", () => {
    expect(normalizeEmail(" HUGO@EXAMPLE.COM ")).toBe("hugo@example.com")
    expect(validateForgotPasswordValues({ email: "hugo@example.com" })).toEqual({})
  })

  it("requires a syntactically valid recovery email", () => {
    expect(validateForgotPasswordValues({ email: "not-email" })).toEqual({
      email: "Enter a valid email address.",
    })
  })

  it("requires a confirmed reset password", () => {
    expect(
      validateResetPasswordValues({
        password: "new-password",
        confirmPassword: "different-password",
      }),
    ).toEqual({ confirmPassword: "Passwords do not match." })
  })

  it("builds reset-password redirects from the current app origin", () => {
    expect(getResetPasswordRedirectUrl("https://app.odessay.com/")).toBe(
      "https://app.odessay.com/auth/confirm?next=%2Freset-password",
    )
  })

  it("prefers the configured app url for auth confirmation redirects", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.odessay.com"

    expect(getAuthConfirmRedirectUrl("http://localhost:3000", "/desk")).toBe(
      "https://app.odessay.com/auth/confirm?next=%2Fdesk",
    )
  })
})
