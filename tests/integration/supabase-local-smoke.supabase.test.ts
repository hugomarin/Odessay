/**
 * ODE-616 PR1 — smoke test del harness Vitest ↔ Supabase local.
 *
 * No prueba SHARE-04 (eso es el PR2): prueba que el andamiaje funciona de
 * punta a punta contra la instancia real compartida, que es lo que consumen
 * ODE-617-B, ODE-618 web, ODE-659 y ODE-660.
 *
 * - El guard rechaza un host remoto y la falta de la service key local.
 * - `sanitizeSupabaseEnv` descarta las *SUPABASE* y TAURI_* heredadas.
 * - `service_role` ejecuta `can_read_writing` (admin.rpc) y `createUserClient`
 *   opera bajo RLS real: el dueño lee su writing privado, el extraño no.
 * - `seedShare` siembra por RLS como dueño y el invitado pasa a leer.
 *
 * Todo el estado se limpia con `cleanupUsers` (deleteUser → cascada); nunca se
 * trunca una tabla. Un tag por archivo.
 *
 * Mutación de BUILD (en vivo): borrar la comprobación de hostname en
 * `assertLocalSupabaseEnv` pone rojo el primer caso. El resto de mutaciones
 * (quitar el filtro de RLS no aplica: no lo controlamos; forzar
 * `sanitizeSupabaseEnv` a copiar el entorno) va en la Guía de review.
 */
import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { assertLocalSupabaseEnv, sanitizeSupabaseEnv } from "../../scripts/lib/supabase-local-env.mjs"
import {
  cleanupUsers,
  seedShare,
  seedUsers,
  seedWriting,
  type SeedUser,
} from "../support/supabase-local/fixtures"
import { createLocalAdminClient, createUserClient, localSupabaseEnv } from "../support/supabase-local/local-supabase"

const runId = randomUUID().replace(/[^a-z0-9]/g, "").slice(0, 8)

let admin: SupabaseClient
let users: SeedUser[] = []
let owner!: SeedUser
let grantee!: SeedUser
let stranger!: SeedUser

beforeAll(async () => {
  admin = createLocalAdminClient()
  users = await seedUsers(runId, ["owner", "grantee", "stranger"])
  ;[owner, grantee, stranger] = users
})

afterAll(async () => {
  await cleanupUsers(users)
})

describe("harness Supabase local", () => {
  it("aborta si el entorno no es el stack local o falta la service key", () => {
    const remote = {
      NEXT_PUBLIC_SUPABASE_URL: "https://production.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    }
    expect(() => assertLocalSupabaseEnv(remote)).toThrow(/stack local|127\.0\.0\.1|localhost/)
    expect(() =>
      assertLocalSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: localSupabaseEnv().url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: "anon",
      }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
    const env = localSupabaseEnv()
    expect(
      assertLocalSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: env.url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: env.publishableKey,
        SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey,
      }).url,
    ).toBe(env.url)
  })

  it("descarta las variables *SUPABASE* y TAURI_* heredadas", () => {
    const env = localSupabaseEnv()
    const localEnv = {
      NEXT_PUBLIC_SUPABASE_URL: env.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: env.publishableKey,
      SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey,
    }
    const sanitized = sanitizeSupabaseEnv(
      {
        PATH: "/usr/bin",
        SUPABASE_SERVICE_ROLE_KEY: "production-service-role",
        NEXT_PUBLIC_SUPABASE_URL: "https://production.supabase.co",
        TAURI_ENV: "desktop",
        TAURI_BUILD: "1",
      },
      localEnv,
    )
    expect(sanitized.PATH).toBe("/usr/bin")
    expect(sanitized.SUPABASE_SERVICE_ROLE_KEY).toBe(env.serviceRoleKey)
    expect(sanitized.NEXT_PUBLIC_SUPABASE_URL).toBe(env.url)
    expect(sanitized.TAURI_ENV).toBeUndefined()
    expect(sanitized.TAURI_BUILD).toBeUndefined()
  })

  it("service_role ejecuta can_read_writing con la semántica de RLS", async () => {
    const writingId = await seedWriting(admin, { authorId: owner.id, visibility: "private" })
    const asOwner = await admin.rpc("can_read_writing", { target_writing_id: writingId, viewer_id: owner.id })
    const asStranger = await admin.rpc("can_read_writing", { target_writing_id: writingId, viewer_id: stranger.id })
    expect(asOwner.error).toBeNull()
    expect(asStranger.error).toBeNull()
    expect(asOwner.data).toBe(true)
    expect(asStranger.data).toBe(false)
  })

  it("createUserClient opera bajo RLS real: el dueño lee su privado y el extraño no", async () => {
    const writingId = await seedWriting(admin, { authorId: owner.id, visibility: "private" })
    const ownerClient = await createUserClient(owner)
    const strangerClient = await createUserClient(stranger)

    const ownerRead = await ownerClient.from("writings").select("id").eq("id", writingId)
    const strangerRead = await strangerClient.from("writings").select("id").eq("id", writingId)
    expect(ownerRead.error).toBeNull()
    expect(strangerRead.error).toBeNull()
    expect(ownerRead.data).toHaveLength(1)
    expect(strangerRead.data).toHaveLength(0)
  })

  it("seedShare siembra por RLS como dueño y habilita al invitado", async () => {
    const writingId = await seedWriting(admin, { authorId: owner.id, visibility: "shared" })
    const ownerClient = await createUserClient(owner)
    await seedShare(ownerClient, { writingId, sharedWithId: grantee.id })

    const granteeClient = await createUserClient(grantee)
    const granteeRead = await granteeClient.from("writings").select("id").eq("id", writingId)
    expect(granteeRead.error).toBeNull()
    expect(granteeRead.data).toHaveLength(1)
  })
})
