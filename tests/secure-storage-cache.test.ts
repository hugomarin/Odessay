import { beforeEach, describe, expect, it, vi } from "vitest"
import type { keychainStorage as KeychainStorageType } from "@/lib/auth/secure-storage"

const tauriKeychainReadMock = vi.hoisted(() => vi.fn())
const tauriKeychainWriteMock = vi.hoisted(() => vi.fn())
const tauriKeychainDeleteMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriKeychainRead: tauriKeychainReadMock,
  tauriKeychainWrite: tauriKeychainWriteMock,
  tauriKeychainDelete: tauriKeychainDeleteMock,
}))

describe("keychainStorage cache", () => {
  let keychainStorage: typeof KeychainStorageType

  beforeEach(async () => {
    vi.resetModules()
    tauriKeychainReadMock.mockReset()
    tauriKeychainWriteMock.mockReset()
    tauriKeychainDeleteMock.mockReset()

    const mod = await import("@/lib/auth/secure-storage")
    keychainStorage = mod.keychainStorage
  })

  it("reads from the native store on first getItem and caches the value", async () => {
    tauriKeychainReadMock.mockResolvedValueOnce("first-token")

    const value = await keychainStorage.getItem("sb-auth-token")

    expect(value).toBe("first-token")
    expect(tauriKeychainReadMock).toHaveBeenCalledTimes(1)
    expect(tauriKeychainReadMock).toHaveBeenCalledWith("sb-auth-token")
  })

  it("serves subsequent getItem calls from cache without touching the native store", async () => {
    tauriKeychainReadMock.mockResolvedValueOnce("cached-token")

    await keychainStorage.getItem("sb-auth-token")
    const second = await keychainStorage.getItem("sb-auth-token")
    const third = await keychainStorage.getItem("sb-auth-token")

    expect(second).toBe("cached-token")
    expect(third).toBe("cached-token")
    expect(tauriKeychainReadMock).toHaveBeenCalledTimes(1)
  })

  it("caches null values so repeated absence checks do not hit the native store", async () => {
    tauriKeychainReadMock.mockResolvedValueOnce(null)

    const first = await keychainStorage.getItem("missing-key")
    const second = await keychainStorage.getItem("missing-key")

    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(tauriKeychainReadMock).toHaveBeenCalledTimes(1)
  })

  it("updates the cache only after the native write succeeds", async () => {
    tauriKeychainReadMock.mockResolvedValueOnce(null)
    tauriKeychainWriteMock.mockResolvedValueOnce(undefined)

    await keychainStorage.setItem("sb-auth-token", "new-token")

    expect(tauriKeychainWriteMock).toHaveBeenCalledTimes(1)
    expect(tauriKeychainWriteMock).toHaveBeenCalledWith("sb-auth-token", "new-token")

    const value = await keychainStorage.getItem("sb-auth-token")
    expect(value).toBe("new-token")
    // setItem primed the cache without reading native first.
    expect(tauriKeychainReadMock).not.toHaveBeenCalled()
  })

  it("does not adopt a new value in cache when the native write fails", async () => {
    tauriKeychainReadMock.mockResolvedValueOnce("existing-token")
    tauriKeychainWriteMock.mockRejectedValueOnce(new Error("keychain locked"))

    await expect(
      keychainStorage.setItem("sb-auth-token", "should-not-cache"),
    ).rejects.toThrow("keychain locked")

    const value = await keychainStorage.getItem("sb-auth-token")
    expect(value).toBe("existing-token")
    expect(tauriKeychainReadMock).toHaveBeenCalledTimes(1)
  })

  it("invalidates the cache on removeItem even when the native delete fails", async () => {
    tauriKeychainReadMock.mockResolvedValueOnce("old-token")
    tauriKeychainDeleteMock.mockRejectedValueOnce(new Error("keychain unreachable"))

    // Prime cache.
    await keychainStorage.getItem("sb-auth-token")

    await keychainStorage.removeItem("sb-auth-token")

    // After removeItem the cache is gone; a new getItem must read native again.
    tauriKeychainReadMock.mockResolvedValueOnce(null)
    const value = await keychainStorage.getItem("sb-auth-token")

    expect(value).toBeNull()
    expect(tauriKeychainDeleteMock).toHaveBeenCalledTimes(1)
    expect(tauriKeychainReadMock).toHaveBeenCalledTimes(2)
  })

  it("completes sign-out + sign-in of a different user without serving the old token", async () => {
    tauriKeychainReadMock.mockResolvedValueOnce("user-a-token")
    tauriKeychainWriteMock.mockResolvedValue(undefined)
    tauriKeychainDeleteMock.mockResolvedValue(undefined)

    // Sign-in user A.
    expect(await keychainStorage.getItem("sb-auth-token")).toBe("user-a-token")

    // Sign-out user A.
    await keychainStorage.removeItem("sb-auth-token")

    // Sign-in user B.
    await keychainStorage.setItem("sb-auth-token", "user-b-token")

    const value = await keychainStorage.getItem("sb-auth-token")
    expect(value).toBe("user-b-token")
    expect(tauriKeychainReadMock).toHaveBeenCalledTimes(1)
  })

  it("keeps different keys isolated in cache", async () => {
    tauriKeychainReadMock
      .mockResolvedValueOnce("auth-token")
      .mockResolvedValueOnce("code-verifier")
      .mockResolvedValueOnce("auth-token")

    const auth = await keychainStorage.getItem("sb-auth-token")
    const verifier = await keychainStorage.getItem("sb-auth-token-code-verifier")

    expect(auth).toBe("auth-token")
    expect(verifier).toBe("code-verifier")
    expect(tauriKeychainReadMock).toHaveBeenCalledTimes(2)

    await keychainStorage.removeItem("sb-auth-token")

    // Auth key was invalidated; verifier key still serves from cache.
    const authAgain = await keychainStorage.getItem("sb-auth-token")
    const verifierAgain = await keychainStorage.getItem("sb-auth-token-code-verifier")

    expect(authAgain).toBe("auth-token")
    expect(verifierAgain).toBe("code-verifier")
    // One extra native read for the invalidated auth key only.
    expect(tauriKeychainReadMock).toHaveBeenCalledTimes(3)
  })
})
