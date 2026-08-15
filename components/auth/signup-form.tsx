"use client"

import { CredentialsForm } from "@/components/auth/credentials-form"

/**
 * Sign up is a mode of the shared credentials card, not a screen of its own.
 */
export function SignupForm() {
  return <CredentialsForm initialMode="signup" />
}
