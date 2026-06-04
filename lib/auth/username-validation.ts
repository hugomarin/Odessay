import { normalizeUsername } from "@/lib/auth/validation"
import type { UsernameAvailability } from "@/lib/services/contracts/auth-service"

type ResolveUsernameAvailabilityInput = {
  requestedUsername: string
  currentUserId?: string | null
  currentUsername?: string | null
  matchingProfileId?: string | null
  reservationOwnerId?: string | null
  reservedUntil?: string | null
}

export function resolveUsernameAvailability(
  input: ResolveUsernameAvailabilityInput,
): UsernameAvailability {
  const username = normalizeUsername(input.requestedUsername)

  if (input.currentUsername === username) {
    return {
      available: true,
      reason: "current",
      reservedUntil: null,
      username,
    }
  }

  if (input.matchingProfileId) {
    return {
      available: false,
      reason: "taken",
      reservedUntil: null,
      username,
    }
  }

  if (
    input.reservationOwnerId &&
    input.reservedUntil &&
    input.currentUserId &&
    input.reservationOwnerId !== input.currentUserId
  ) {
    return {
      available: false,
      reason: "reserved",
      reservedUntil: input.reservedUntil,
      username,
    }
  }

  return {
    available: true,
    reason: "available",
    reservedUntil: null,
    username,
  }
}
