/** @vitest-environment happy-dom */
import { mkdtempSync, rmSync } from "node:fs"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  failNextRenameFile,
  holdOpenFile,
  holdWriteFile,
  holdWriteFileAfterDiskWrite,
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
 * Bug (caracterización del commit rojo, cuerpo conservado sin cambios): sin
 * guard de `write_file` no hay `CONFLICT` y `persistFollowingRename` (que solo
 * reacciona a `CONFLICT`) nunca reencamina; el `write_file` recrea la ruta
 * vieja, `persist()` no puede ligarla a la fila ya movida y cae al
 * `workspace_sync` con hint, que rebindea la ruta vieja al mismo UUID. Quedan
 * dos archivos y el catálogo vuelve a la ruta vieja.
 *
 * Fix (ODE-635): `persist()` espera al rename en curso, relee el binding y, si
 * el write aterrizó en una ruta que el documento ya no posee, retira esa
 * recreación por el trash del owner de filesystem y lanza `CONFLICT` para que
 * `persistFollowingRename` reintente en la ruta actual. `null` sigue siendo
 * "sin baseline": no se sustituye ningún hash.
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
 * control es que el guardado retenido resuelve sin error y que el rename
 * completa, y la propiedad se mide sobre el disco y el catálogo.
 *
 * Mutation control (corrido en rojo antes del PR): quitar el chequeo de ruta
 * obsoleta o quitar el retiro de la recreación deja dos archivos y el catálogo
 * en la ruta vieja; quitar la espera a `renamesInFlight` pone rojo el caso
 * hermano de la ventana move→commit.
 */
describe("ODE-635 — guardado sin baseline que se cruza con un rename", () => {
  it(
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

  /**
   * ODE-635 — la ventana move→commit del rename (el P0 de ODE-629) con un
   * guardado sin baseline: el `write_file` sin guard aterriza en la ruta vieja
   * mientras el rename ya movió el archivo pero todavía no commiteó el
   * catálogo. Leer el catálogo ahí devuelve la ruta vieja, así que sin esperar
   * al rename en curso el guardado commitea el binding obsoleto y el rename lo
   * pisa después: quedan dos archivos y el renombrado se queda con `BASE`.
   *
   * Propiedad: el guardado sin baseline espera al rename en curso y, al ver
   * que el binding ya no es la ruta que escribió, retira esa recreación
   * (recuperable, vía trash del owner de filesystem) y reintenta en la ruta
   * nueva. Muta a rojo si `persist()` deja de esperar a `renamesInFlight`.
   */
  it(
    "un guardado sin baseline que aterriza entre el move y el commit del rename llega a la ruta nueva",
    async () => {
      const draft = await createDesktopDraft({ title: "ODE629 Midflight", initialBodyJson: bodyJson("BASE") })
      const record = draft.data!
      const service = await getDocumentService()
      const before = await tauriCatalogGetByIdDouble(await desktopDbPath(), record.id)
      const originalPath = before!.canonicalPath!
      const renamedName = "ODE629 Midflight Renombrado.md"

      // El guardado más nuevo sale con baseline nulo y queda retenido en
      // `write_file` sobre la ruta vieja, ya con su ruta resuelta.
      const heldWrite = holdWriteFile((path) => path === originalPath)
      const save = service.saveWriting({
        writing: {
          ...record,
          content: { ...record.content, richText: bodyJson("NUEVO"), plainText: "NUEVO" },
        },
        expectedContentHash: null,
      })
      await heldWrite.started

      // El rename mueve el archivo y queda retenido leyendo la ruta nueva,
      // antes de commitear el catálogo: la ventana del P0 de ODE-629.
      const heldRenameRead = holdOpenFile((path) => path.endsWith(`/${renamedName}`))
      const rename = service.renameWriting({
        writingId: record.id,
        title: "ODE629 Midflight Renombrado",
        updatedAt: new Date().toISOString(),
      })
      await heldRenameRead.started

      // El guardado aterriza en la ruta vieja (recreándola) mientras el
      // catálogo todavía liga el UUID a esa ruta.
      heldWrite.release()
      await vi.waitFor(async () => {
        const contents = await readFile(originalPath, "utf8").catch(() => "")
        expect(contents, "control positivo: el write sin guard ya está en disco").toContain("NUEVO")
      })

      heldRenameRead.release()
      const renamed = await rename
      expect(renamed.error, "control positivo: el rename completa").toBeNull()
      const saved = await save
      expect(saved.error, "el guardado no se rinde en la ventana move→commit").toBeNull()

      const files = await writingFiles()
      expect(files.map((file) => file.name), "un solo archivo, el renombrado").toEqual([renamedName])
      expect(files[0]?.contents, "el guardado sin baseline aterriza en el archivo renombrado").toContain("NUEVO")
      const row = await tauriCatalogGetByIdDouble(await desktopDbPath(), record.id)
      expect(row!.canonicalPath, "el catálogo apunta al archivo renombrado").toBe(
        join(await writingsDir(), renamedName),
      )
    },
  )

  /**
   * ODE-635 (review ronda 1, P1) — el retiro de la recreación no puede
   * llevarse contenido de otro escritor. El `write_file` sin guard recrea la
   * ruta vieja; si en la ventana write → retiro otro escritor reemplaza esa
   * ruta, el retiro por Trash original se llevaba ese contenido. El retiro
   * debe comparar el hash de lo que hay en disco contra el markdown que ESTA
   * operación escribió: solo retira la recreación exacta; cualquier contenido
   * distinto queda recuperable en la ruta vieja y el guardado reintenta en la
   * ruta nueva con el `CONFLICT` existente.
   *
   * Propiedad: el contenido del escritor externo no termina en `.trash`
   * —sigue legible en la ruta vieja, que ya no pertenece a este UUID— y el
   * guardado aterriza en el archivo renombrado. Muta a rojo si el retiro deja
   * de comparar antes de mover a Trash.
   */
  it.fails(
    "un escritor externo que reemplaza la recreación antes del retiro la deja recuperable, no en Trash",
    async () => {
      const draft = await createDesktopDraft({ title: "ODE635 Externo", initialBodyJson: bodyJson("BASE") })
      const record = draft.data!
      const service = await getDocumentService()
      const before = await tauriCatalogGetByIdDouble(await desktopDbPath(), record.id)
      const originalPath = before!.canonicalPath!
      const renamedName = "ODE635 Externo Renombrado.md"
      const externalMarkdown = "# Aporte de otro escritor\n\ntexto externo\n"

      // El guardado sale con baseline nulo y queda retenido dos veces: antes
      // de escribir en disco y, ya escrita la recreación, antes de que el
      // invoke resuelva. El escritor externo entra en esa segunda ventana.
      const heldWrite = holdWriteFile((path) => path === originalPath)
      const heldAfterDiskWrite = holdWriteFileAfterDiskWrite((path) => path === originalPath)
      const save = service.saveWriting({
        writing: {
          ...record,
          content: { ...record.content, richText: bodyJson("NUEVO"), plainText: "NUEVO" },
        },
        expectedContentHash: null,
      })
      await heldWrite.started

      // El rename completa de verdad mientras el guardado sigue en vuelo:
      // mueve el archivo y commitea el catálogo a la ruta nueva.
      const renamed = await service.renameWriting({
        writingId: record.id,
        title: "ODE635 Externo Renombrado",
        updatedAt: new Date().toISOString(),
      })
      expect(renamed.error, "control positivo: el rename completa").toBeNull()

      // El write sin guard recrea la ruta vieja y queda retenido después de
      // escribir en disco, todavía en vuelo.
      heldWrite.release()
      await heldAfterDiskWrite.started

      // Otro escritor reemplaza la ruta obsoleta en la ventana write → retiro.
      await writeFile(originalPath, externalMarkdown, "utf8")

      heldAfterDiskWrite.release()
      const saved = await save
      expect(saved.error, "control positivo: el guardado retenido resuelve").toBeNull()

      // Propiedad: el contenido externo no se tira a Trash; sigue recuperable
      // en la ruta vieja, y el guardado aterriza en el archivo renombrado.
      const contentsAtOldPath = await readFile(originalPath, "utf8").catch(() => "")
      expect(contentsAtOldPath, "el contenido externo queda recuperable en la ruta vieja").toBe(externalMarkdown)
      const trash = await trashFiles()
      expect(trash, "el contenido externo no termina en Trash").toEqual([])
      const files = await writingFiles()
      expect(
        files.map((file) => file.name).sort(),
        "el renombrado sigue activo y la ruta vieja conserva el contenido externo",
      ).toEqual(["ODE635 Externo Renombrado.md", "ODE635 Externo.md"].sort())
      const renamedFile = files.find((file) => file.name === renamedName)
      expect(renamedFile?.contents, "el guardado aterriza en el archivo renombrado").toContain("NUEVO")
      const row = await tauriCatalogGetByIdDouble(await desktopDbPath(), record.id)
      expect(row!.canonicalPath, "el catálogo apunta al archivo renombrado").toBe(
        join(await writingsDir(), renamedName),
      )
    },
  )

  /**
   * ODE-635 (review ronda 1, P2) — el `ServiceResponse.error` del retiro no se
   * puede ignorar. `FilesystemDocumentService.deleteWriting` convierte fallos
   * de lectura/rename en un resultado con `error`; si el retiro falla y se
   * ignora, el `CONFLICT` dispara el retry, que guarda con éxito en la ruta
   * nueva mientras la recreación vieja sigue en el root: el caller ve éxito
   * con el estado que la Decisión A exige retirar. El error del retiro debe
   * propagarse antes de permitir que el retry complete.
   *
   * Propiedad: el caller no ve éxito; la recreación sigue en la ruta vieja
   * (sin pérdida) y el catálogo no vuelve a ligarla. Muta a rojo si el
   * resultado del retiro se ignora.
   */
  it.fails(
    "si el retiro de la recreación falla, el guardado no reporta éxito",
    async () => {
      const draft = await createDesktopDraft({ title: "ODE635 RetiroFallido", initialBodyJson: bodyJson("BASE") })
      const record = draft.data!
      const service = await getDocumentService()
      const before = await tauriCatalogGetByIdDouble(await desktopDbPath(), record.id)
      const originalPath = before!.canonicalPath!
      const renamedName = "ODE635 RetiroFallido Renombrado.md"

      const heldWrite = holdWriteFile((path) => path === originalPath)
      const save = service.saveWriting({
        writing: {
          ...record,
          content: { ...record.content, richText: bodyJson("NUEVO"), plainText: "NUEVO" },
        },
        expectedContentHash: null,
      })
      await heldWrite.started

      const renamed = await service.renameWriting({
        writingId: record.id,
        title: "ODE635 RetiroFallido Renombrado",
        updatedAt: new Date().toISOString(),
      })
      expect(renamed.error, "control positivo: el rename completa").toBeNull()

      // El próximo `rename_file` es el que retira la recreación al Trash:
      // falla como un error nativo.
      failNextRenameFile(() => {
        throw new Error("EPERM: no se pudo mover la recreación a .trash")
      })

      heldWrite.release()
      const saved = await save

      // Propiedad: el caller no ve éxito mientras la recreación sigue en el
      // root; el error del retiro se propaga y el catálogo sigue en la ruta
      // nueva, sin re-ligar la vieja.
      expect(saved.error, "el guardado no reporta éxito si el retiro falla").not.toBeNull()
      expect(saved.error?.code, "el error del retiro se propaga").toBe("STORAGE_ERROR")
      const recreation = await readFile(originalPath, "utf8").catch(() => "")
      expect(recreation, "la recreación sigue en la ruta vieja, sin pérdida").toContain("NUEVO")
      const row = await tauriCatalogGetByIdDouble(await desktopDbPath(), record.id)
      expect(row!.canonicalPath, "el catálogo sigue en la ruta nueva").toBe(
        join(await writingsDir(), renamedName),
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

async function trashFiles(): Promise<Array<{ name: string; contents: string }>> {
  const dir = join(await writingsDir(), ".trash")
  const names = await readdir(dir).catch(() => [] as string[])
  return Promise.all(
    names.map(async (name) => ({ name, contents: await readFile(join(dir, name), "utf8") })),
  )
}
