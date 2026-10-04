/**
 * Contrato del adapter `invoke(command, args)` → dobles por comando del
 * harness (ODE-651).
 *
 * Prueba directa del router: los comandos con forma no posicional se mapean
 * por nombre de campo (el orden de las claves del objeto de `invoke` no
 * importa), el comando desconocido falla, y las dos traducciones nativas
 * (`settings_read` serializado y `CONFLICT:` como string) se conservan. Para
 * `catalog_list` se usa `tauriCatalogListQueryDouble`, el espejo fiel de los
 * filtros y el orden del SQL real (no el atajo que ignora la query).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { tauriInvokeRouterDouble } from "../../support/editor-shell-doubles"
import {
  resetCatalogDoubles,
  tauriCatalogDualWriteDouble,
  tauriCatalogListQueryDouble,
} from "./support/real-desktop-doubles"

const DB_PATH = "/tmp/ode-651/catalogo.db"

async function seedCatalogRows() {
  await tauriCatalogDualWriteDouble(DB_PATH, {
    document: {
      id: "doc-local",
      localPresent: true,
      cloudPresent: false,
      cloudAccountId: null,
      syncStatus: "local-only",
      title: "Local",
      slug: null,
      status: null,
      artifactType: null,
      visibility: null,
      version: null,
      deletedAt: null,
      createdAt: 1,
      modifiedAt: 3,
    },
    binding: null,
    mutation: null,
  })
  await tauriCatalogDualWriteDouble(DB_PATH, {
    document: {
      id: "doc-cloud",
      localPresent: false,
      cloudPresent: true,
      cloudAccountId: "cuenta-a",
      syncStatus: "synced",
      title: "Cloud",
      slug: null,
      status: null,
      artifactType: null,
      visibility: null,
      version: null,
      deletedAt: null,
      createdAt: 2,
      modifiedAt: 2,
    },
    binding: null,
    mutation: null,
  })
  await tauriCatalogDualWriteDouble(DB_PATH, {
    document: {
      id: "doc-deleted",
      localPresent: true,
      cloudPresent: false,
      cloudAccountId: null,
      syncStatus: "deleted",
      title: "Deleted",
      slug: null,
      status: null,
      artifactType: null,
      visibility: null,
      version: null,
      deletedAt: "2026-10-01T00:00:00Z",
      createdAt: 3,
      modifiedAt: 9,
    },
    binding: null,
    mutation: null,
  })
}

describe("tauriInvokeRouterDouble — adapter de args por comando", () => {
  beforeEach(() => {
    resetCatalogDoubles()
  })

  it("settings_write mapea configDir/key/valueJson por nombre aunque el orden de las claves cambie", async () => {
    const settingsWrite = vi.fn(async () => undefined)
    const router = tauriInvokeRouterDouble({ tauriSettingsWrite: settingsWrite })
    const value = { theme: "dark", nested: { depth: 2 } }

    await router("settings_write", {
      valueJson: JSON.stringify(value),
      key: "apariencia",
      configDir: "/tmp/ode-651/config",
    })

    expect(settingsWrite).toHaveBeenCalledTimes(1)
    expect(settingsWrite).toHaveBeenCalledWith("/tmp/ode-651/config", "apariencia", value)
  })

  it("settings_write rechaza un valueJson que no es string", async () => {
    const settingsWrite = vi.fn(async () => undefined)
    const router = tauriInvokeRouterDouble({ tauriSettingsWrite: settingsWrite })

    await expect(
      router("settings_write", { key: "apariencia", valueJson: 42, configDir: "/tmp/ode-651/config" }),
    ).rejects.toThrow("settings_write requiere valueJson como string")
    expect(settingsWrite).not.toHaveBeenCalled()
  })

  it("settings_read mapea por nombre y devuelve el resultado serializado", async () => {
    const settingsRead = vi.fn(async () => ({ theme: "dark", nested: { depth: 2 } }))
    const router = tauriInvokeRouterDouble({ tauriSettingsRead: settingsRead })

    const result = await router("settings_read", { key: "apariencia", configDir: "/tmp/ode-651/config" })

    expect(settingsRead).toHaveBeenCalledWith("/tmp/ode-651/config", "apariencia")
    expect(typeof result).toBe("string")
    expect(JSON.parse(result as string)).toEqual({ theme: "dark", nested: { depth: 2 } })
  })

  it("falla con el nombre del comando cuando no hay doble registrado", async () => {
    const router = tauriInvokeRouterDouble({})

    await expect(router("comando_inexistente", { any: "arg" })).rejects.toThrow(
      "Comando Tauri sin doble registrado: comando_inexistente",
    )
  })

  it("rechaza write_file con el CONFLICT: del doble como string, no como Error", async () => {
    const conflict = "CONFLICT: /tmp/ode-651/carta.md was replaced on disk since it was resolved"
    const writeFile = vi.fn(async () => {
      throw new Error(conflict)
    })
    const router = tauriInvokeRouterDouble({ tauriWriteFile: writeFile })

    await expect(
      router("write_file", {
        path: "/tmp/ode-651/carta.md",
        content: "cuerpo",
        expectedContentHash: "hash-a",
        expectedInode: 7,
      }),
    ).rejects.toBe(conflict)
    expect(writeFile).toHaveBeenCalledWith("/tmp/ode-651/carta.md", "cuerpo", "hash-a", 7)
  })

  it("catalog_list entrega el query como objeto, reconstruido por nombre desde campos en orden aleatorio", async () => {
    await seedCatalogRows()
    const router = tauriInvokeRouterDouble({ tauriCatalogList: tauriCatalogListQueryDouble })

    const localOnly = await router("catalog_list", {
      limit: 1,
      localOnly: true,
      dbPath: DB_PATH,
      includeDeleted: false,
      cloudAccountId: null,
    })
    expect((localOnly as Array<{ id: string }>).map((row) => row.id)).toEqual(["doc-local"])

    const withDeletedAndAccount = await router("catalog_list", {
      includeDeleted: true,
      cloudAccountId: "cuenta-a",
      dbPath: DB_PATH,
      limit: 10,
      localOnly: false,
    })
    expect((withDeletedAndAccount as Array<{ id: string }>).map((row) => row.id)).toEqual([
      "doc-deleted",
      "doc-local",
      "doc-cloud",
    ])
  })

  it("catalog_apply_workspace_removal pasa el nowMillis interno por nombre, no por posición", async () => {
    const removal = vi.fn(async () => ["doc-local"])
    const router = tauriInvokeRouterDouble({ tauriCatalogApplyWorkspaceRemoval: removal })

    await router("catalog_apply_workspace_removal", {
      updatedAt: "2026-10-04T00:00:00Z",
      dbPath: DB_PATH,
      nowMillis: 1_700_000_000_000,
      rootPath: "/tmp/ode-651/workspace",
      bindingRootId: "root-ode-651",
      deletedAt: "2026-10-03T00:00:00Z",
    })

    expect(removal).toHaveBeenCalledWith(
      DB_PATH,
      "root-ode-651",
      "/tmp/ode-651/workspace",
      "2026-10-03T00:00:00Z",
      "2026-10-04T00:00:00Z",
      1_700_000_000_000,
    )
  })
})
