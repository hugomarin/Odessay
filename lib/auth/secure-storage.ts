"use client"

import {
  tauriKeychainDelete,
  tauriKeychainRead,
  tauriKeychainWrite,
} from "@/lib/services/desktop/tauri-commands"

const STORAGE_TIMEOUT_MS = 3000

async function withTimeout<T>(
  promise: Promise<T>,
  operation: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`[secure-storage] ${operation} timed out after ${STORAGE_TIMEOUT_MS}ms`)),
        STORAGE_TIMEOUT_MS,
      ),
    ),
  ])
}

/**
 * Supabase-compatible async storage adapter backed by tauri-plugin-store.
 *
 * Used exclusively in the desktop runtime (Tauri). Supabase's createClient
 * accepts async storage adapters, so every auth token write/read/delete goes through
 * the native store instead of localStorage. Entries are persisted to
 * `$APPDATA/odessay/secure.dat`.
 *
 * Invariants (per ODE-219 Architecture Contract):
 *   - tokens are NEVER written to localStorage or any plain-text disk location
 *   - token values are NEVER logged to console or telemetry
 *   - getItem / setItem / removeItem are all async — callers must await them
 *
 * Process-memory cache (ODE-354):
 *   - getItem serves from cache after the first native read
 *   - setItem updates cache only after the native write succeeds
 *   - removeItem invalidates cache even if the native delete fails
 *   - cache lives only in process memory and is dropped on app restart
 */

// In-process cache for token values. Keys are storage keys; values are the
// opaque strings stored by Supabase (or null when the key is absent).
const cache = new Map<string, string | null>()

export const keychainStorage = {
  async getItem(key: string): Promise<string | null> {
    const cached = cache.get(key)
    if (cached !== undefined) {
      return cached
    }

    const value = await withTimeout(tauriKeychainRead(key), `getItem(${key})`)
    cache.set(key, value)
    return value
  },

  async setItem(key: string, value: string): Promise<void> {
    await withTimeout(tauriKeychainWrite(key, value), `setItem(${key})`)
    cache.set(key, value)
  },

  async removeItem(key: string): Promise<void> {
    cache.delete(key)

    try {
      await withTimeout(tauriKeychainDelete(key), `removeItem(${key})`)
    } catch (err) {
      // Never block sign-out (or any auth flow) because the store plugin is
      // unresponsive. The session will be unreachable on next app start
      // because getItem will return null.
      console.warn("[secure-storage] removeItem failed, continuing:", err)
    }
  },
}
