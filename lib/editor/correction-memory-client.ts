import { stableFingerprintFromStoredFingerprint } from "@/lib/corrections/engine/identity"

type CorrectionMemoryEntry = {
  fingerprint: string
  decision: "accepted" | "rejected"
  decidedAt: string
}

export const CORRECTION_MEMORY_STORAGE_KEY = "odessay-correction-memory"

export const readCorrectionMemory = (): CorrectionMemoryEntry[] => {
  if (typeof window === "undefined") {
    return []
  }

  try {
    const value = window.localStorage.getItem(CORRECTION_MEMORY_STORAGE_KEY)
    const parsed = value ? JSON.parse(value) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const rememberCorrectionDecision = (
  fingerprint: string | null | undefined,
  decision: "accepted" | "rejected",
) => {
  if (!fingerprint || typeof window === "undefined") {
    return
  }

  const stableFingerprint = stableFingerprintFromStoredFingerprint(fingerprint)
  const entries = readCorrectionMemory().filter((entry) => {
    if (entry.fingerprint === fingerprint) {
      return false
    }

    return stableFingerprintFromStoredFingerprint(entry.fingerprint) !== stableFingerprint
  })
  entries.push({
    fingerprint,
    decision,
    decidedAt: new Date().toISOString(),
  })

  window.localStorage.setItem(CORRECTION_MEMORY_STORAGE_KEY, JSON.stringify(entries.slice(-200)))
}

export const forgetCorrectionDecision = (fingerprint: string | null | undefined) => {
  if (!fingerprint || typeof window === "undefined") {
    return
  }

  const stableFingerprint = stableFingerprintFromStoredFingerprint(fingerprint)
  const entries = readCorrectionMemory().filter((entry) => {
    if (entry.fingerprint === fingerprint) {
      return false
    }

    return stableFingerprintFromStoredFingerprint(entry.fingerprint) !== stableFingerprint
  })

  window.localStorage.setItem(CORRECTION_MEMORY_STORAGE_KEY, JSON.stringify(entries))
}
