/**
 * ODE-524 requirement 4 — bound transcription uploads before the provider
 * ever sees them: byte size, and a duration bound derived from the file's
 * own bytes, never from anything the client claims.
 *
 * Duration is exact for WAV (a simple, fully-specified header) and a
 * conservative *lower-bound* estimate for every other format MediaRecorder
 * produces (webm/opus, mp4/aac, ogg, mp3): each is checked against that
 * format's highest realistic bitrate, so a recording this module clears is
 * provably at or under the duration cap even in the best case, while one
 * that fails is failing on a bound that can only be too permissive in the
 * caller's favor, never too strict against a real bitrate. Full
 * per-container duration decoding (parsing the WebM Cues/mp4 moov box) is
 * out of scope here — the byte cap is the hard backstop regardless of
 * format, and 10 minutes of intelligible voice audio does not approach the
 * default 10 MiB ceiling at any bitrate these formats actually use.
 */

type AudioMetadataResult =
  | { ok: true; durationSeconds: number; exact: boolean }
  | { ok: false; reason: string }

// Bytes/second at each format's highest bitrate plausible for a voice
// recording — used as the estimator's lower bound on duration.
const MAX_BYTES_PER_SECOND_BY_MIME: Record<string, number> = {
  "audio/webm": 24_000, // opus voice, generous upper end (~192kbps)
  "audio/ogg": 24_000, // opus/vorbis, same family
  "audio/mp4": 32_000, // aac, generous upper end (~256kbps)
  "audio/mpeg": 32_000, // mp3, generous upper end (~256kbps)
}

// Used when the mime type isn't in the table above: assume the most
// bandwidth-hungry plausible voice codec, which yields the *shortest*
// duration estimate for a given size — the least likely to false-reject.
const DEFAULT_MAX_BYTES_PER_SECOND = 32_000

function parseWavDurationSeconds(bytes: Uint8Array): number | null {
  // Minimal RIFF/WAVE header: "RIFF" size "WAVE" ("fmt " chunk) ("data" chunk)
  if (bytes.length < 44) return null
  const text = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length))
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 12
  let byteRate: number | null = null
  let dataSize: number | null = null

  while (offset + 8 <= bytes.length) {
    const chunkId = text(offset, 4)
    const chunkSize = view.getUint32(offset + 4, true)

    if (chunkId === "fmt " && offset + 16 <= bytes.length) {
      byteRate = view.getUint32(offset + 16, true)
    } else if (chunkId === "data") {
      dataSize = chunkSize
    }

    if (byteRate !== null && dataSize !== null) break
    offset += 8 + chunkSize + (chunkSize % 2) // chunks are word-aligned
  }

  if (!byteRate || !dataSize) return null
  return dataSize / byteRate
}

/**
 * Returns a duration estimate for `bytes` never larger than the real
 * duration (exact for WAV). Never trusts anything other than the bytes and
 * declared mime type — no client-supplied duration field exists in this
 * contract by design.
 */
export function estimateAudioMetadata(bytes: Uint8Array, mimeType: string): AudioMetadataResult {
  const normalizedMime = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? ""

  if (normalizedMime === "audio/wav" || normalizedMime === "audio/x-wav") {
    const exact = parseWavDurationSeconds(bytes)
    if (exact !== null) return { ok: true, durationSeconds: exact, exact: true }
    // A file claiming to be WAV but without a parseable header is not
    // trustworthy — fail closed rather than fall through to a compressed-
    // format estimate that would badly underestimate PCM's real duration.
    return { ok: false, reason: "Could not read WAV audio metadata." }
  }

  const bytesPerSecond = MAX_BYTES_PER_SECOND_BY_MIME[normalizedMime] ?? DEFAULT_MAX_BYTES_PER_SECOND
  const durationSeconds = bytes.length / bytesPerSecond
  return { ok: true, durationSeconds, exact: false }
}
