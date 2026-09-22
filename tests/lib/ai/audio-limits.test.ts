import { describe, expect, it } from "vitest"
import { estimateAudioMetadata } from "@/lib/ai/audio-limits"

function buildWavBytes({ sampleRate = 16_000, bitsPerSample = 16, channels = 1, durationSeconds = 2 }: {
  sampleRate?: number
  bitsPerSample?: number
  channels?: number
  durationSeconds?: number
} = {}) {
  const blockAlign = (channels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const dataSize = Math.round(byteRate * durationSeconds)
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeString(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(36, "data")
  view.setUint32(40, dataSize, true)

  return new Uint8Array(buffer)
}

describe("estimateAudioMetadata", () => {
  it("computes the exact duration for a well-formed WAV header", () => {
    const bytes = buildWavBytes({ durationSeconds: 3 })
    const result = estimateAudioMetadata(bytes, "audio/wav")

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.exact).toBe(true)
      expect(result.durationSeconds).toBeCloseTo(3, 2)
    }
  })

  it("accepts the audio/x-wav alias with a leading whitespace-insensitive, case-insensitive mime type", () => {
    const bytes = buildWavBytes({ durationSeconds: 1 })
    const result = estimateAudioMetadata(bytes, " AUDIO/X-WAV ;codecs=1")

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.durationSeconds).toBeCloseTo(1, 2)
  })

  it("fails closed when a file claims to be WAV but has no parseable RIFF header", () => {
    const result = estimateAudioMetadata(new Uint8Array([1, 2, 3, 4]), "audio/wav")

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/WAV/i)
  })

  it("estimates a lower-bound duration for a compressed format from its highest plausible bitrate", () => {
    // 24,000 bytes/sec is webm's assumed ceiling — 48,000 bytes should
    // estimate to roughly 2 seconds, never more than the real duration.
    const bytes = new Uint8Array(48_000)
    const result = estimateAudioMetadata(bytes, "audio/webm")

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.exact).toBe(false)
      expect(result.durationSeconds).toBeCloseTo(2, 5)
    }
  })

  it("falls back to the most conservative bitrate for an unrecognized mime type", () => {
    const bytes = new Uint8Array(32_000)
    const result = estimateAudioMetadata(bytes, "audio/x-mystery-codec")

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.durationSeconds).toBeCloseTo(1, 5)
  })
})
