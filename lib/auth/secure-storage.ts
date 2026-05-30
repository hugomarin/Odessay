"use client"

import {
  tauriKeychainDelete,
  tauriKeychainRead,
  tauriKeychainWrite,
} from "@/lib/services/desktop/tauri-commands"

/**
 * Supabase-compatible async storage adapter backed by macOS Keychain.
 *
 * Used exclusively in the desktop runtime (Tauri). Supabase's createBrowserClient
 * accepts async storage adapters, so every auth token write/read/delete goes through
 * the native Keychain instead of localStorage. Entries appear in Keychain Access
 * under the "Odessay" service name.
 *
 * Invariants (per ODE-219 Architecture Contract):
 *   - tokens are NEVER written to localStorage or any plain-text disk location
 *   - token values are NEVER logged to console or telemetry
 *   - getItem / setItem / removeItem are all async — callers must await them
 */
export const keychainStorage = {
  async getItem(key: string): Promise<string | null> {
    return tauriKeychainRead(key)
  },

  async setItem(key: string, value: string): Promise<void> {
    return tauriKeychainWrite(key, value)
  },

  async removeItem(key: string): Promise<void> {
    return tauriKeychainDelete(key)
  },
}
