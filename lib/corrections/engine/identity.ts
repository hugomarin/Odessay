export type StableCorrectionIdentity = {
  type: string
  originalText: string
  replacementText: string
}

export const normalizeFingerprintPart = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ")

export const createStableFingerprint = (correction: StableCorrectionIdentity) =>
  [
    normalizeFingerprintPart(correction.type),
    normalizeFingerprintPart(correction.originalText),
    normalizeFingerprintPart(correction.replacementText),
  ].join("|")

export const stableFingerprintFromStoredFingerprint = (fingerprint: string | null | undefined): string | null => {
  if (!fingerprint || typeof fingerprint !== "string") {
    return null
  }

  const parts = fingerprint.split("|").map(normalizeFingerprintPart).filter((part) => part.length > 0)
  if (parts.length < 3) {
    return null
  }

  return parts.slice(-3).join("|")
}
