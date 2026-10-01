// ODE-616 PR1 — semillas y limpieza del harness. Cada archivo usa su propio
// tag/runId y solo borra sus usuarios (deleteUser → cascada); nunca se trunca
// una tabla, porque la instancia local se comparte entre worktrees.
//
// `seedUsers` lee el username real de `profiles` porque
// `ensure_unique_username` normaliza el valor y agrega sufijos.

import { randomUUID } from "node:crypto"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { createLocalAdminClient, localSupabaseEnv } from "./local-supabase"

export type SeedUser = {
  id: string
  email: string
  password: string
  username: string
  accessToken: string
  refreshToken: string
}

export const SEED_PASSWORD = "local-supabase-password"

export const SEED_WRITING_BODY = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "ODE-616 harness" }] }],
}

function seedUsernameBase(role: string, tag: string): string {
  return `${role}_${tag}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 30)
}

export async function seedUsers(tag: string, roles: readonly string[]): Promise<SeedUser[]> {
  const admin = createLocalAdminClient()
  const env = localSupabaseEnv()
  const users: SeedUser[] = []

  for (const role of roles) {
    const username = seedUsernameBase(role, tag)
    const email = `${username}@example.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: SEED_PASSWORD,
      email_confirm: true,
      user_metadata: { username },
    })
    if (error || !data.user) {
      throw new Error(`[supabase-local] createUser(${email}) falló: ${error?.message ?? "sin usuario"}`)
    }

    const profile = await admin.from("profiles").select("username").eq("id", data.user.id).single()
    if (profile.error || !profile.data) {
      throw new Error(`[supabase-local] el trigger no creó el profile de ${email}: ${profile.error?.message ?? "sin fila"}`)
    }

    const anon = createClient(env.url, env.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const signIn = await anon.auth.signInWithPassword({ email, password: SEED_PASSWORD })
    if (signIn.error || !signIn.data.session) {
      throw new Error(`[supabase-local] signInWithPassword(${email}) falló: ${signIn.error?.message ?? "sin sesión"}`)
    }

    users.push({
      id: data.user.id,
      email,
      password: SEED_PASSWORD,
      username: profile.data.username,
      accessToken: signIn.data.session.access_token,
      refreshToken: signIn.data.session.refresh_token,
    })
  }

  return users
}

export async function cleanupUsers(users: readonly Pick<SeedUser, "id">[]): Promise<void> {
  if (users.length === 0) return
  const admin = createLocalAdminClient()
  const failures: string[] = []
  for (const user of users) {
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) failures.push(`${user.id}: ${error.message}`)
  }
  if (failures.length > 0) {
    throw new Error(`[supabase-local] cleanupUsers falló: ${failures.join("; ")}`)
  }
}

export type SeedWritingInput = {
  authorId: string
  title?: string
  visibility?: "private" | "shared" | "public"
  status?: "draft" | "finished"
  version?: number
  bodyJson?: unknown
}

export async function seedWriting(admin: SupabaseClient, input: SeedWritingInput): Promise<string> {
  const id = randomUUID()
  const { error } = await admin.from("writings").insert({
    id,
    author_id: input.authorId,
    title: input.title ?? "ODE-616 harness",
    visibility: input.visibility ?? "private",
    status: input.status ?? "draft",
    version: input.version ?? 1,
    body_json: input.bodyJson ?? SEED_WRITING_BODY,
  })
  if (error) throw new Error(`[supabase-local] seedWriting falló: ${error.message}`)
  return id
}

export async function seedShare(
  owner: SupabaseClient,
  input: { writingId: string; sharedWithId: string },
): Promise<string> {
  const id = randomUUID()
  const { error } = await owner.from("writing_shares").insert({
    id,
    writing_id: input.writingId,
    shared_with_id: input.sharedWithId,
  })
  if (error) throw new Error(`[supabase-local] seedShare falló: ${error.message}`)
  return id
}

export async function seedCollection(
  owner: SupabaseClient,
  input: { ownerId: string; name?: string; visibility?: "private" | "public" },
): Promise<string> {
  const id = randomUUID()
  const { error } = await owner.from("collections").insert({
    id,
    owner_id: input.ownerId,
    name: input.name ?? "ODE-616 harness",
    visibility: input.visibility ?? "private",
  })
  if (error) throw new Error(`[supabase-local] seedCollection falló: ${error.message}`)
  return id
}

export async function seedMembership(
  owner: SupabaseClient,
  input: { writingId: string; collectionId: string },
): Promise<void> {
  const { error } = await owner.from("writing_collections").insert({
    writing_id: input.writingId,
    collection_id: input.collectionId,
  })
  if (error) throw new Error(`[supabase-local] seedMembership falló: ${error.message}`)
}

export async function readRow<T = Record<string, unknown>>(
  admin: SupabaseClient,
  table: string,
  id: string,
): Promise<T | null> {
  const { data, error } = await admin.from(table).select("*").eq("id", id).maybeSingle()
  if (error) throw new Error(`[supabase-local] readRow(${table}) falló: ${error.message}`)
  return (data as T | null) ?? null
}

export async function readRows<T = Record<string, unknown>>(
  admin: SupabaseClient,
  table: string,
  column: string,
  value: string,
): Promise<T[]> {
  const { data, error } = await admin.from(table).select("*").eq(column, value)
  if (error) throw new Error(`[supabase-local] readRows(${table}) falló: ${error.message}`)
  return (data as T[] | null) ?? []
}
