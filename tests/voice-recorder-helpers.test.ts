import { describe, expect, it } from "vitest"
import { appendWaveformSample, calculateWaveformRms } from "@/hooks/useVoiceRecorder"
import { buildWaveformBars, formatVoiceRecorderDuration } from "@/components/reading/margins/voice-recorder-controls"

describe("voice recorder helpers", () => {
  it("computes a normalized RMS sample from analyser data", () => {
    expect(calculateWaveformRms(new Uint8Array([]))).toBe(0)
    expect(calculateWaveformRms(new Uint8Array([128, 128, 128]))).toBe(0)
    expect(calculateWaveformRms(new Uint8Array([0, 255]))).toBeGreaterThan(0.9)
  })

  it("caps waveform history to the requested number of samples", () => {
    const history = [0.1, 0.2, 0.3]
    expect(appendWaveformSample(history, 0.4, 3)).toEqual([0.2, 0.3, 0.4])
    expect(appendWaveformSample([], 2, 3)).toEqual([1])
    expect(appendWaveformSample([], -1, 3)).toEqual([0])
  })

  it("formats duration as mm:ss", () => {
    expect(formatVoiceRecorderDuration(0)).toBe("00:00")
    expect(formatVoiceRecorderDuration(9)).toBe("00:09")
    expect(formatVoiceRecorderDuration(65)).toBe("01:05")
  })

  it("pads waveform bars to a fixed-length history for rendering", () => {
    expect(buildWaveformBars([0.2, 0.4], 4)).toEqual([0, 0, 0.2, 0.4])
    expect(buildWaveformBars([0.1, 0.2, 0.3, 0.4, 0.5], 3)).toEqual([0.3, 0.4, 0.5])
  })
})
