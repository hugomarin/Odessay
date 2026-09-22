import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "@/app/(auth)/auth/confirm/route"

const verifyOtpMock = vi.hoisted(() => vi.fn())
const createClientMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}))

const appOrigin = "https://app.odessay.com"

function confirmRequest(query: Record<string, string>) {
  const url = new URL(`${appOrigin}/auth/confirm`)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  return new Request(url.toString())
}

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    createClientMock.mockReset()
    verifyOtpMock.mockReset()
    createClientMock.mockResolvedValue({ auth: { verifyOtp: verifyOtpMock } })
  })

  it("redirects to /login with an error when token_hash or type is missing", async () => {
    const response = await GET(confirmRequest({ next: "/desk" }) as never)

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get("location")!)
    expect(location.origin).toBe(appOrigin)
    expect(location.pathname).toBe("/login")
    expect(location.searchParams.get("error")).toBe("invalid_verification_link")
    expect(verifyOtpMock).not.toHaveBeenCalled()
  })

  it("redirects to /login with the provider's error when OTP verification fails", async () => {
    verifyOtpMock.mockResolvedValue({ error: { message: "Token has expired." } })

    const response = await GET(
      confirmRequest({ token_hash: "abc", type: "signup", next: "/desk" }) as never,
    )

    const location = new URL(response.headers.get("location")!)
    expect(location.origin).toBe(appOrigin)
    expect(location.pathname).toBe("/login")
    expect(location.searchParams.get("error")).toBe("Token has expired.")
  })

  describe("after a successful OTP verification", () => {
    beforeEach(() => {
      verifyOtpMock.mockResolvedValue({ error: null })
    })

    it.each(["/desk", "/reset-password", "/settings/account", "/write?id=abc-123#top"])(
      "preserves a valid internal destination: %s",
      async (next) => {
        const response = await GET(
          confirmRequest({ token_hash: "abc", type: "signup", next }) as never,
        )

        const location = new URL(response.headers.get("location")!)
        expect(location.origin).toBe(appOrigin)
        expect(`${location.pathname}${location.search}${location.hash}`).toBe(next)
      },
    )

    it("falls back to / when the request has no next param", async () => {
      const response = await GET(confirmRequest({ token_hash: "abc", type: "signup" }) as never)

      const location = new URL(response.headers.get("location")!)
      expect(location.origin).toBe(appOrigin)
      expect(location.pathname).toBe("/")
    })

    const adversarialNextValues: Array<[string, string]> = [
      ["/\\attacker.invalid", "single backslash bypass"],
      ["/\\\\attacker.invalid", "double backslash bypass"],
      ["//attacker.invalid", "protocol-relative form"],
      ["https://attacker.invalid/steal", "absolute external URL"],
      ["https://user:pass@app.odessay.com/desk", "embedded credentials"],
      ["https://app.odessay.com:4443/desk", "alternate port"],
      ["javascript:alert(document.domain)", "non-http(s) scheme"],
    ]

    it.each(adversarialNextValues)(
      "never leaves the application origin for an adversarial next value (%s: %s)",
      async (next) => {
        const response = await GET(
          confirmRequest({ token_hash: "abc", type: "signup", next }) as never,
        )

        const location = new URL(response.headers.get("location")!)
        expect(location.origin).toBe(appOrigin)
        expect(location.pathname).toBe("/")
      },
    )

    it("rejects a next value carrying an encoded backslash (percent-decoded to a literal backslash by URLSearchParams)", async () => {
      const url = new URL(`${appOrigin}/auth/confirm`)
      url.searchParams.set("token_hash", "abc")
      url.searchParams.set("type", "signup")
      // Raw query string carries the encoded form; URLSearchParams.get()
      // decodes it once, producing "/\attacker.invalid" before it ever
      // reaches the validator — the same bypass as the literal-backslash
      // case above, arriving through the wire format an email link actually
      // uses.
      const request = new Request(`${url.toString()}&next=%2F%5Cattacker.invalid`)

      const response = await GET(request as never)

      const location = new URL(response.headers.get("location")!)
      expect(location.origin).toBe(appOrigin)
      expect(location.pathname).toBe("/")
    })

    it("rejects a next value with a raw control character", async () => {
      const url = new URL(`${appOrigin}/auth/confirm`)
      url.searchParams.set("token_hash", "abc")
      url.searchParams.set("type", "signup")
      const request = new Request(`${url.toString()}&next=%2Fdesk%00.evil`)

      const response = await GET(request as never)

      const location = new URL(response.headers.get("location")!)
      expect(location.origin).toBe(appOrigin)
      expect(location.pathname).toBe("/")
    })
  })
})
