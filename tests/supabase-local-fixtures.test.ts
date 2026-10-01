/**
 * ODE-616 PR1 — limpieza de cuentas parciales en `seedUsers`.
 *
 * `seedUsers` crea la cuenta con `auth.admin.createUser` y después lee el
 * profile y hace un signIn. Si cualquiera de esos pasos falla, la cuenta ya
 * existe en la instancia compartida; el error se propaga y el `beforeAll` del
 * suite consumidor conserva `users = []`, así que su `afterAll` no puede
 * borrarla. El fix registra el id apenas se crea y borra las cuentas del
 * camino de error.
 *
 * Solo se dobla la frontera externa (el cliente de Supabase): un admin falso
 * con la forma de llamada de supabase-js. La secuencia de `seedUsers` es la
 * real.
 *
 * Mutación de la Guía de review: quitar el borrado del camino de error en
 * `seedUsers` (dejar solo `throw error`) pone rojos los dos casos.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { seedUsers } from "./support/supabase-local/fixtures"

const state = vi.hoisted(() => ({
  createdIds: [] as string[],
  deletedIds: [] as string[],
  signInCalls: 0,
  failSignInAt: 0,
  profileFails: false,
}))

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async () => {
        state.signInCalls += 1
        if (state.failSignInAt > 0 && state.signInCalls >= state.failSignInAt) {
          return { data: { session: null }, error: { message: "rate limit exceeded" } }
        }
        return { data: { session: { access_token: "access", refresh_token: "refresh" } }, error: null }
      },
    },
  }),
}))

vi.mock("./support/supabase-local/local-supabase", () => ({
  localSupabaseEnv: () => ({
    url: "http://127.0.0.1:54321",
    publishableKey: "publishable",
    serviceRoleKey: "service-role",
  }),
  createLocalAdminClient: () => ({
    auth: {
      admin: {
        createUser: async () => {
          const id = `user-${state.createdIds.length + 1}`
          state.createdIds.push(id)
          return { data: { user: { id } }, error: null }
        },
        deleteUser: async (id: string) => {
          state.deletedIds.push(id)
          return { error: null }
        },
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (state.profileFails) {
              return { data: null, error: { message: "permission denied for table profiles" } }
            }
            return { data: { username: "seed_user" }, error: null }
          },
        }),
      }),
    }),
  }),
}))

beforeEach(() => {
  state.createdIds = []
  state.deletedIds = []
  state.signInCalls = 0
  state.failSignInAt = 0
  state.profileFails = false
})

describe("seedUsers limpia las cuentas parciales", () => {
  it("borra la cuenta si falla la lectura del profile", async () => {
    state.profileFails = true

    await expect(seedUsers("pr1owner", ["owner"])).rejects.toThrow(/profile/)

    expect(state.createdIds).toEqual(["user-1"])
    expect(state.deletedIds).toEqual(["user-1"])
  })

  it("borra la cuenta completa y la parcial si falla el signIn de la segunda", async () => {
    state.failSignInAt = 2

    await expect(seedUsers("pr1owner", ["owner", "grantee"])).rejects.toThrow(/signInWithPassword/)

    expect(state.createdIds).toEqual(["user-1", "user-2"])
    expect(state.deletedIds).toEqual(["user-1", "user-2"])
  })
})
