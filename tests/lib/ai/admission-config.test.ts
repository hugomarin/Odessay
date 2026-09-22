import { afterEach, describe, expect, it } from "vitest"
import { getAdmissionConfig, getAudioLimitsConfig, resetAdmissionConfigCacheForTests } from "@/lib/ai/admission-config"

describe("getAdmissionConfig", () => {
  afterEach(() => {
    delete process.env.AI_QUOTA_TITLE_SUGGESTIONS_PER_MIN
    delete process.env.AI_QUOTA_PUBLICATION_REVIEW_PER_MIN
    delete process.env.AI_QUOTA_TRANSCRIPTION_PER_MIN
    delete process.env.AI_QUOTA_CONCURRENCY_PER_ACCOUNT
    delete process.env.AI_QUOTA_LEASE_SECONDS
    resetAdmissionConfigCacheForTests()
  })

  it("uses the documented defaults when no env vars are set", () => {
    const config = getAdmissionConfig()

    expect(config.routes["title-suggestions"].rateLimit).toBe(10)
    expect(config.routes["publication-review"].rateLimit).toBe(5)
    expect(config.routes.transcription.rateLimit).toBe(5)
    expect(config.concurrencyLimit).toBe(2)
    expect(config.leaseSeconds).toBe(90)
  })

  it("honors an env var override", () => {
    process.env.AI_QUOTA_CONCURRENCY_PER_ACCOUNT = "9"
    resetAdmissionConfigCacheForTests()

    expect(getAdmissionConfig().concurrencyLimit).toBe(9)
  })

  it.each(["0", "-1", "not-a-number", "1.5"])(
    "fails loudly on a misconfigured limit (%s) instead of admitting unlimited traffic",
    (value) => {
      process.env.AI_QUOTA_CONCURRENCY_PER_ACCOUNT = value
      resetAdmissionConfigCacheForTests()

      expect(() => getAdmissionConfig()).toThrow(/AI_QUOTA_CONCURRENCY_PER_ACCOUNT/)
    },
  )

  it("caches the config across calls until reset", () => {
    process.env.AI_QUOTA_LEASE_SECONDS = "30"
    resetAdmissionConfigCacheForTests()
    const first = getAdmissionConfig()

    process.env.AI_QUOTA_LEASE_SECONDS = "999"
    const second = getAdmissionConfig()

    expect(first).toBe(second)
    expect(second.leaseSeconds).toBe(30)
  })
})

describe("getAudioLimitsConfig", () => {
  afterEach(() => {
    delete process.env.AI_TRANSCRIPTION_MAX_AUDIO_BYTES
    delete process.env.AI_TRANSCRIPTION_MAX_AUDIO_SECONDS
    resetAdmissionConfigCacheForTests()
  })

  it("defaults to 10 MiB and 10 minutes", () => {
    const config = getAudioLimitsConfig()

    expect(config.maxBytes).toBe(10 * 1024 * 1024)
    expect(config.maxDurationSeconds).toBe(600)
  })

  it("honors env var overrides", () => {
    process.env.AI_TRANSCRIPTION_MAX_AUDIO_BYTES = "2048"
    process.env.AI_TRANSCRIPTION_MAX_AUDIO_SECONDS = "30"
    resetAdmissionConfigCacheForTests()

    const config = getAudioLimitsConfig()
    expect(config.maxBytes).toBe(2048)
    expect(config.maxDurationSeconds).toBe(30)
  })
})
