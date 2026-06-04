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
 */
export const keychainStorage = {
  async getItem(key: string): Promise<string | null> {
    return withTimeout(tauriKeychainRead(key), `getItem(${key})`)
  },

  async setItem(key: string, value: string): Promise<void> {
    return withTimeout(tauriKeychainWrite(key, value), `setItem(${key})`)
  },

  async removeItem(key: string): Promise<void> {
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
