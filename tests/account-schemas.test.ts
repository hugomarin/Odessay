import { describe, expect, it } from "vitest"
import {
  updateDisplayNameSchema,
  updateEmailSchema,
  updatePasswordSchema,
  updateUsernameSchema,
} from "@/lib/validation/account-schemas"

describe("account schemas", () => {
  it("accepts a valid display name", () => {
    const result = updateDisplayNameSchema.parse({ displayName: "Hugo Marin" })
    expect(result.displayName).toBe("Hugo Marin")
  })

  it("normalizes a valid username with hyphen support", () => {
    const result = updateUsernameSchema.parse({ username: " Hugo-Marin " })
    expect(result.username).toBe("hugo-marin")
  })

  it("rejects invalid usernames", () => {
    const result = updateUsernameSchema.safeParse({ username: "No Spaces" })
    expect(result.success).toBe(false)
  })

  it("normalizes a valid email", () => {
    const result = updateEmailSchema.parse({ email: " HUGO@EXAMPLE.COM " })
    expect(result.email).toBe("hugo@example.com")
  })

  it("requires a different confirmed password", () => {
    const result = updatePasswordSchema.safeParse({
      currentPassword: "password-123",
      newPassword: "password-123",
      confirmPassword: "password-123",
    })

    expect(result.success).toBe(false)
  })
})
