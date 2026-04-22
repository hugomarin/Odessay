import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/shared"

export type AccountSettingsSnapshot = {
  id: string
  email: string
  displayName: string
  username: string
}

export type UsernameAvailability = {
  available: boolean
  reason: "available" | "current" | "taken" | "reserved"
  reservedUntil: string | null
}

export async function getCurrentAccountSettings(): Promise<AccountSettingsSnapshot | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.id || !user.email) {
    return null
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", user.id)
    .single()

  if (error || !profile) {
    return null
  }

  return {
    id: user.id,
    email: user.email,
    displayName: profile.display_name,
    username: profile.username,
  }
}

export async function syncUserMetadata(userId: string, metadata: Record<string, string>) {
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: metadata,
  })

  if (error) {
    throw error
  }
}

export async function updateDisplayNameForUser(userId: string, displayName: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select("display_name")
    .single()

  if (error || !data) {
    throw error ?? new Error("Display name update failed.")
  }

  await syncUserMetadata(userId, { display_name: data.display_name })

  return data.display_name
}

export async function getUsernameAvailability(
  userId: string,
  username: string,
): Promise<UsernameAvailability> {
  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  const [{ data: profile }, { data: reservation }] = await Promise.all([
    admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle(),
    admin
      .from("username_reservations")
      .select("owner_id, reserved_until")
      .eq("username", username)
      .gt("reserved_until", nowIso)
      .maybeSingle(),
  ])

  if (profile?.id === userId) {
    return {
      available: true,
      reason: "current",
      reservedUntil: null,
    }
  }

  if (profile?.id) {
    return {
      available: false,
      reason: "taken",
      reservedUntil: null,
    }
  }

  if (reservation && reservation.owner_id !== userId) {
    return {
      available: false,
      reason: "reserved",
      reservedUntil: reservation.reserved_until,
    }
  }

  return {
    available: true,
    reason: "available",
    reservedUntil: null,
  }
}

export async function claimUsernameForCurrentUser(username: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("claim_profile_username", {
    target_username: username,
  })

  if (error) {
    throw error
  }

  const row = Array.isArray(data) ? data[0] : data

  if (!row) {
    throw new Error("Username update returned no data.")
  }

  return {
    username: row.username as string,
    previousUsername: row.previous_username as string,
    reservedUntil: (row.reserved_until as string | null) ?? null,
  }
}

export async function verifyCurrentPassword(email: string, password: string) {
  const verificationClient = createSupabaseClient(supabaseUrl, supabasePublicKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { error } = await verificationClient.auth.signInWithPassword({
    email,
    password,
  })

  return !error
}
