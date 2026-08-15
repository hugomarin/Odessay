"use client"

import { CredentialsForm } from "@/components/auth/credentials-form"

/**
 * Sign in is a mode of the shared credentials card, not a screen of its own.
 */
export function LoginForm() {
  return <CredentialsForm initialMode="signin" />
}
