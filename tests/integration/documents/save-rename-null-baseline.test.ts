/** @vitest-environment happy-dom */
import { mkdtempSync, rmSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  holdWriteFile,
  configureRealDesktopDoubles,
  resetCatalogDoubles,
  resetWriteFileFailureState,
  tauriCatalogDetachLocalFileDouble,
  tauriCatalogDualWriteDouble,
  tauriCatalogGetByIdDouble,
  tauriCatalogListDouble,
  tauriCatalogResolvePathDouble,
  tauriCreateFileDouble,
  tauriListRecentFilesDouble,
  tauriOpenFileDouble,
  tauriPathModuleDouble,
  tauriRenameFileDouble,
  tauriWorkspaceSyncDouble,
  tauriWorkspaceTouchFileDouble,
  tauriWriteFileDouble,
} from "./support/real-desktop-doubles"

function unimplemented(name: string) {
  return vi.fn(async () => {
    throw new Error(`real-desktop-doubles: "${name}" is out of scope for ODE-635 and was not expected to be called`)
  })
}

vi.mock("@tauri-apps/api/path", () => tauriPathModuleDouble)

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriCreateFile: tauriCreateFileDouble,
  tauriWriteFile: tauriWriteFileDouble,
  tauriOpenFile: tauriOpenFileDouble,
  tauriListRecentFiles: tauriListRecentFilesDouble,
  // El rename real de este caso: mueve el archivo y lo lee de vuelta, igual
  // que el `rename_file` de Rust (ver `FilesystemDocumentService.renameWriting`).
  tauriRenameFile: tauriRenameFileDouble,
  tauriRelocateFile: unimplemented("tauriRelocateFile"),
  tauriWorkspaceSync: tauriWorkspaceSyncDouble,
  tauriWorkspaceTouchFile: tauriWorkspaceTouchFileDouble,
  tauriCatalogDualWrite: tauriCatalogDualWriteDouble,
  tauriCatalogBulkDualWrite: unimplemented("tauriCatalogBulkDualWrite"),
  tauriCatalogGetById: tauriCatalogGetByIdDouble,
  tauriCatalogResolvePath: tauriCatalogResolvePathDouble,
  tauriCatalogList: tauriCatalogListDouble,
  tauriCatalogDetachLocalFile: tauriCatalogDetachLocalFileDouble,
  tauriCatalogHydrateExcerpts: vi.fn(async () => []),
  tauriCatalogApplyReconcile: unimplemented("tauriCatalogApplyReconcile"),
  tauriCatalogApplyCloudSnapshots: unimplemented("tauriCatalogApplyCloudSnapshots"),
  tauriCatalogApplyWorkspaceRemoval: unimplemented("tauriCatalogApplyWorkspaceRemoval"),
  tauriCatalogActivateBindingRoot: unimplemented("tauriCatalogActivateBindingRoot"),
  tauriCatalogCountBindingRootDocuments: unimplemented("tauriCatalogCountBindingRootDocuments"),
  tauriCatalogListBindingRootDocuments: unimplemented("tauriCatalogListBindingRootDocuments"),
  tauriCatalogListRetiredBindingRoots: unimplemented("tauriCatalogListRetiredBindingRoots"),
  tauriCatalogReactivateBindingRoot: unimplemented("tauriCatalogReactivateBindingRoot"),
}))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => true,
}))

vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))

const { createDesktopDraft, getDocumentService } = await import("@/lib/services/document-service-factory")

const bodyJson = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })

let workspaceRoot: string

beforeAll(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "odessay-ode635-"))
  configureRealDesktopDoubles(workspaceRoot)
})

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

afterEach(() => {
  resetCatalogDoubles()
  resetWriteFileFailureState()
  rmSync(join(workspaceRoot, "data"), { recursive: true, force: true })
  rmSync(join(workspaceRoot, "config"), { recursive: true, force: true })
})

/**
 * ODE-635 — follow-up P3 del review de ODE-629 (PR #537): un guardado con
 * `expectedContentHash: null` que se cruza con un rename.
 *
 * Property: un guardado sin baseline durable que ya resolvió su ruta no puede
 * recrear el archivo en la ruta vieja cuando un rename lo movió mientras el
 * `write_file` estaba en vuelo; el contenido nuevo tiene que terminar en el
 * archivo renombrado, con un solo archivo y el catálogo apuntando a él.
 *
 * Bug vigente: sin guard de `write_file` no hay `CONFLICT` y
 * `persistFollowingRename` (que solo reacciona a `CONFLICT`) nunca reencamina;
 * el `write_file` recrea la ruta vieja, `persist()` no puede ligarla a la fila
 * ya movida y cae al `workspace_sync` con hint, que rebindea la ruta vieja al
 * mismo UUID. Quedan dos archivos y el catálogo vuelve a la ruta vieja.
 *
 * Entrada real del camino: `saveWriting` con `expectedContentHash: null` es una
 * llamada de producción — `PersistenceCoordinator.persistNow` manda null
 * cuando no tiene baseline durable (`persistence-coordinator.ts:690-692`), y el
 * review lo reprodujo mutando exactamente ese punto. Aquí se pasa null directo
 * al servicio, su dueño, sin doblar el coordinador.
 *
 * Real collaborators: `DesktopDocumentService` (real), `FilesystemDocumentService`
 * (real), `SqliteDocumentCatalog` (real) sobre el doble conductual real de los
 * comandos nativos (fs real + catálogo en memoria con las reglas de
 * consistencia de Rust). Único fake permitido: el transporte nativo y el flush
 * de nube, igual que DOC-02/03/06 y WATCH-07.
 *
 * Control positivo: el mismo caso con baseline correcto es el `it` de la
 * carrera en `tests/editor-shell-create-rename.test.tsx` (ODE-629); aquí el
 * control es que el guardado retenido resuelve sin error (no falla: escribe,
 * solo que en la ruta equivocada) y que el rename completa.
 *
 * Mutation control (por qué esto es `it.fails`): adoptar la dirección de fix ya
 * validada en el issue (usar `existing.binding.contentHash` como baseline
 * cuando el caller manda null, o serializar el guardado con el rename en
 * curso) hace que el cuerpo pase y este `it.fails` se ponga rojo — es la señal
 * de que el bug quedó cerrado y el caso debe promoverse a `it` sin tocar su
 * cuerpo, como manda el contrato de la red.
 */
describe("ODE-635 — guardado sin baseline que se cruza con un rename (bug vigente)", () => {
  it.fails(
    "un guardado sin baseline que se cruza con un rename no recrea el archivo en la ruta vieja",
    async () => {
      const draft = await createDesktopDraft({ title: "ODE629 Null", initialBodyJson: bodyJson("BASE") })
      const record = draft.data!
      const service = await getDocumentService()
      const before = await tauriCatalogGetByIdDouble(await desktopDbPath(), record.id)
      const originalPath = before!.canonicalPath!

      // El guardado más nuevo sale con baseline nulo y queda retenido en
      // `write_file` sobre la ruta vieja, ya con su ruta resuelta.
      const held = holdWriteFile((path) => path === originalPath)
      const save = service.saveWriting({
        writing: {
          ...record,
          content: { ...record.content, richText: bodyJson("NUEVO"), plainText: "NUEVO" },
        },
        expectedContentHash: null,
      })
      await held.started

      // El rename completa de verdad mientras el guardado sigue en vuelo.
      const renamed = await service.renameWriting({
        writingId: record.id,
        title: "ODE629 Null Renombrado",
        updatedAt: new Date().toISOString(),
      })
      expect(renamed.error, "control positivo: el rename completa").toBeNull()
      const afterRename = await tauriCatalogGetByIdDouble(await desktopDbPath(), record.id)
      expect(afterRename!.canonicalPath, "control positivo: el catálogo ya está en la ruta nueva").not.toBe(
        originalPath,
      )

      held.release()
      const saved = await save
      // Control positivo: no falla (no hay guard que lo rechace); escribe, pero
      // en la ruta que ya no es la del documento.
      expect(saved.error, "control positivo: el guardado sin baseline no es rechazado").toBeNull()

      // Propiedad deseada: un solo archivo, el renombrado, con lo nuevo, y el
      // catálogo apuntándole.
      const files = await writingFiles()
      expect(files.map((file) => file.name), "un solo archivo, el renombrado").toEqual([
        "ODE629 Null Renombrado.md",
      ])
      expect(files[0]?.contents, "el guardado sin baseline aterriza en el archivo renombrado").toContain("NUEVO")
      const row = await tauriCatalogGetByIdDouble(await desktopDbPath(), record.id)
      expect(row!.canonicalPath, "el catálogo apunta al archivo renombrado").toBe(
        join(await writingsDir(), "ODE629 Null Renombrado.md"),
      )
    },
  )
})

// ─── helpers ────────────────────────────────────────────────────────────────

async function writingFiles(): Promise<Array<{ name: string; contents: string }>> {
  const dir = await writingsDir()
  const names = await readdir(dir).catch(() => [] as string[])
  return Promise.all(
    names
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map(async (name) => ({ name, contents: await readFile(join(dir, name), "utf8") })),
  )
}

async function desktopDbPath(): Promise<string> {
  const { appConfigDir, join: joinAsync } = tauriPathModuleDouble
  return joinAsync(await appConfigDir(), "desktop-index.sqlite3")
}

async function writingsDir(): Promise<string> {
  const { appDataDir, join: joinAsync } = tauriPathModuleDouble
  return joinAsync(await appDataDir(), "Writings")
}
