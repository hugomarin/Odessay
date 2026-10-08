/** @vitest-environment happy-dom */
/**
 * ODE-684 — failure and deferred-write evidence for component documents.
 *
 * The user-visible cases enter through the production EditorShell, real
 * TipTap, the real PersistenceCoordinator, DesktopDocumentService and
 * FilesystemDocumentService. Only the native Tauri transport and external
 * cloud flush are doubled; writes hit a real temporary filesystem and catalog
 * projection uses the canonical behavioral double. The separate bulk case
 * exercises the metadata batch contract: content saves use commitDualWrite,
 * while updateWritingsMetadata owns commitBulkDualWrite.
 */
import { readFileSync } from "node:fs"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("../../support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("next/navigation", async () =>
  (await import("../../support/editor-shell-doubles")).nextNavigationDouble(),
)
vi.mock("@tauri-apps/api/event", async () =>
  (await import("../../support/editor-shell-doubles")).tauriEventDouble(),
)
vi.mock("@tauri-apps/plugin-dialog", async () =>
  (await import("../../support/editor-shell-doubles")).tauriDialogDouble(),
)
vi.mock("@/lib/services/desktop/runtime-detection", async () =>
  (await import("../../support/editor-shell-doubles")).runtimeDetectionDouble(),
)
vi.mock("@/lib/services/ai-service-factory", async () =>
  (await import("../../support/editor-shell-doubles")).aiServiceDouble(),
)
vi.mock("@/lib/editor/persistence-coordinator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/editor/persistence-coordinator")>()
  const { recordPersistenceCoordinator } = await import("../../support/persistence-coordinator-capture")
  return {
    ...actual,
    createPersistenceCoordinator: (...args: Parameters<typeof actual.createPersistenceCoordinator>) => {
      const coordinator = actual.createPersistenceCoordinator(...args)
      recordPersistenceCoordinator(coordinator)
      return coordinator
    },
  }
})
vi.mock("@tauri-apps/api/path", async () =>
  (await import("../../support/editor-shell-desktop-doubles")).tauriPathDouble(),
)
vi.mock("@/lib/services/desktop/tauri-commands", async () => {
  const desktop = await import("../../support/editor-shell-desktop-doubles")
  const doubles = await import("./support/real-desktop-doubles")
  return {
    ...desktop.tauriCommandsDouble(),
    tauriCatalogBulkDualWrite: doubles.tauriCatalogBulkDualWriteDouble,
  }
})
vi.mock("@/lib/sync/sync-service-factory", async () =>
  (await import("../../support/editor-shell-desktop-doubles")).syncServiceDouble(),
)

const { act } = await import("react")
const {
  advance,
  capturePersistenceCoordinators,
  clickNewArtifact,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  selectEditorText,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
} = await import("../../support/editor-shell-harness")
const {
  createDesktopWorkspace,
  destroyDesktopWorkspace,
  desktopWorkspaceRoot,
  readWorkspaceMarkdown,
  resetDesktopWorkspace,
} = await import("../../support/editor-shell-desktop-doubles")
const {
  catalogMutationsDouble,
  failNextBulkDualWrite,
  failNextDualWrite,
  failNextWriteFile,
  holdWriteFile,
  writeFileCalls,
} = await import("./support/real-desktop-doubles")
const { DESKTOP_PERSISTENCE_DEBOUNCE_MS } = await import("@/components/editor/editor-shell")
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { getDocumentService } = await import("@/lib/services/document-service-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")

const TEST_TIMEOUT_MS = 90_000
const SAVE_WINDOW_MS = DESKTOP_PERSISTENCE_DEBOUNCE_MS + 1_000
const MASTER_SOURCE = readFileSync("tests/fixtures/document-components/valid/master.md", "utf8")
const MASTER_SEED = "DOC_COMPONENT_MASTER_SEED"
const DB_PATH_SUFFIX = "config/desktop-index.sqlite3"
const SAVE_STATE_BY_LABEL: Record<string, string> = {
  Saved: "saved",
  "Saving...": "saving",
  "Saved locally": "saved-local",
  "Needs attention": "error",
}

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let coordinatorCapture: ReturnType<typeof capturePersistenceCoordinators> | null = null
let releasePendingWrite: (() => void) | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-component-save-faults-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(async () => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  await writeEditorSession(createEmptyEditorSession())
})

afterEach(async () => {
  releasePendingWrite?.()
  releasePendingWrite = null
  coordinatorCapture?.stop()
  coordinatorCapture = null
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
})

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)
}

function activeWritingId() {
  const writingId = activeTab()?.writing_id
  return writingId && writingId !== EDITOR_DRAFT_TAB_ID ? writingId : null
}

function barSaveState() {
  const label = mounted?.container
    .querySelector('[data-testid="editor-statusbar"] [aria-live="polite"]')
    ?.textContent?.trim()
  return label === undefined ? null : (SAVE_STATE_BY_LABEL[label] ?? `unknown: ${label}`)
}

function markdownSource() {
  return mounted!.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]')
}

async function switchMode(label: "Rich" | "Markdown") {
  const button = await waitFor(
    () =>
      Array.from(
        mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
      ).find((candidate) => (candidate.textContent ?? "").trim() === label),
    { label: `botón "${label}" de la status bar` },
  )
  await act(async () => button.click())
  await flush(2)
  await waitFor(
    () => (label === "Markdown" ? markdownSource() : !markdownSource() && mounted!.prosemirror()),
    { label: `editor en modo ${label}` },
  )
}

async function replaceMarkdownSource(value: string) {
  const textarea = markdownSource()
  if (!textarea) throw new Error("El editor no está en modo Markdown")
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush(1)
}

async function placeCaretAfter(needle: string) {
  const target = await selectEditorText(needle)
  await act(async () => {
    mounted!.editor().commands.focus()
    mounted!.editor().commands.setTextSelection(target.to)
  })
  await flush(1)
}

async function contentsOf(path: string) {
  const files = await readWorkspaceMarkdown()
  return files.find((file) => file.path === path)?.contents ?? ""
}

async function createMasterDocument() {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
  await clickNewArtifact(mounted.container)
  await typeInEditor(MASTER_SEED)
  await advance(SAVE_WINDOW_MS)
  const file = await waitForMarkdownContaining(MASTER_SEED)
  const writingId = await waitFor(activeWritingId, { label: "identidad documental", timeoutMs: 15_000 })
  await switchMode("Markdown")
  await replaceMarkdownSource(MASTER_SOURCE)
  await switchMode("Rich")
  await advance(SAVE_WINDOW_MS)
  const canonical = await waitForMarkdownContaining(MASTER_SEED)
  expect(canonical.path).toBe(file.path)
  return { file, writingId, canonical: canonical.contents }
}

async function waitForVisibleError() {
  await waitFor(() => activeTab()?.save_state === "error" && barSaveState() === "error", {
    label: "el estado durable no confirma el guardado fallido",
    timeoutMs: 15_000,
  })
}

function dbPath() {
  return `${desktopWorkspaceRoot()}/${DB_PATH_SUFFIX}`
}

describe("ODE-684 — fallos de guardado de documentos con componentes", () => {
  it(
    "un fallo de .md queda en Needs attention, conserva la edición y no crea un draft",
    async () => {
      const { file, writingId, canonical } = await createMasterDocument()
      const errors = vi.spyOn(console, "error").mockImplementation(() => {})
      failNextWriteFile(
        (path) => path === file.path,
        () => {
          throw new Error("disk full")
        },
      )

      await placeCaretAfter(MASTER_SEED)
      await typeInEditor(" FS_WRITE_FAILURE_COMPONENT")
      await advance(SAVE_WINDOW_MS)
      await waitForVisibleError()

      expect(
        errors.mock.calls.some(
          ([message, detail]) =>
            message === "[editor:save] local save failed" &&
            (detail as { error?: string } | undefined)?.error === "disk full",
        ),
        "control positivo: falló la escritura nativa del .md",
      ).toBe(true)
      expect(await contentsOf(file.path), "el archivo conserva el último snapshot confirmado").toBe(canonical)
      expect(mounted!.editor().getText()).toContain("FS_WRITE_FAILURE_COMPONENT")
      expect(activeWritingId(), "la identidad fallida sigue asociada a la misma pestaña").toBe(writingId)
      expect(await readWorkspaceMarkdown(), "no se abre un archivo draft de fallback").toHaveLength(1)
      expect(await (await getDocumentCatalog()).getById(writingId)).toMatchObject({ id: writingId })
      expect(barSaveState(), "no hay Saved falso").toBe("error")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "un fallo de commitDualWrite no encola snapshot ni muestra Saved aunque el .md haya llegado",
    async () => {
      const { file, writingId } = await createMasterDocument()
      const catalog = await getDocumentCatalog()
      const rowBefore = await catalog.getById(writingId)
      if (!rowBefore) throw new Error("El maestro no tiene fila de catálogo")
      const mutationsBefore = catalogMutationsDouble(dbPath()).filter((mutation) => mutation.documentId === writingId)
      const errors = vi.spyOn(console, "error").mockImplementation(() => {})
      failNextDualWrite(() => {
        throw new Error("catalog transaction failed")
      })

      await placeCaretAfter(MASTER_SEED)
      await typeInEditor(" CATALOG_COMMIT_FAILURE_COMPONENT")
      await advance(SAVE_WINDOW_MS)
      await waitForVisibleError()

      expect(
        errors.mock.calls.some(
          ([message, detail]) =>
            message === "[editor:save] local save failed" &&
            (detail as { error?: string } | undefined)?.error === "catalog transaction failed",
        ),
        "control positivo: falló el commit de catálogo/enqueue",
      ).toBe(true)
      expect(await contentsOf(file.path)).toContain("CATALOG_COMMIT_FAILURE_COMPONENT")
      expect((await catalog.getById(writingId))?.version, "la proyección SQL no avanzó").toBe(rowBefore.version)
      expect(
        catalogMutationsDouble(dbPath()).filter((mutation) => mutation.documentId === writingId),
        "la transacción no deja una mutación de sync parcial",
      ).toEqual(mutationsBefore)
      expect(activeWritingId()).toBe(writingId)
      expect(await readWorkspaceMarkdown(), "no se crea una identidad de fallback").toHaveLength(1)
      expect(barSaveState(), "el editor no anuncia Saved ante proyección fallida").toBe("error")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "la escritura retenida no se confirma hasta que el archivo y el payload de componentes quedan durables",
    async () => {
      coordinatorCapture = capturePersistenceCoordinators()
      const { file, writingId, canonical } = await createMasterDocument()
      const writesBefore = writeFileCalls().filter((call) => call.path === file.path).length
      const held = holdWriteFile((path) => path === file.path)
      releasePendingWrite = held.release

      await placeCaretAfter("CARD_BODY_MASTER")
      await typeInEditor(" DURABLE_COMPONENT_PAYLOAD")
      await advance(SAVE_WINDOW_MS)
      await held.started

      expect(activeTab()?.save_state, "el guardado retenido sigue pending").toBe("saving")
      expect(barSaveState(), "la barra no puede decir Saved antes del completion event").toBe("saving")
      expect(await contentsOf(file.path), "el archivo sigue en el snapshot anterior").toBe(canonical)
      const heldCall = writeFileCalls().filter((call) => call.path === file.path).at(-1)
      expect(heldCall?.content).toContain("DURABLE_COMPONENT_PAYLOAD")
      expect(heldCall?.content).toContain('title="Card maestro"')

      held.release()
      releasePendingWrite = null
      expect(await coordinatorCapture.settle(), "el completion event espera el commit real").toBe(true)
      const durable = await contentsOf(file.path)
      expect(durable).toContain("DURABLE_COMPONENT_PAYLOAD")
      expect(durable).toContain('<Card title="Card maestro" icon="star"')
      expect(durable).toContain("CARD_BODY_MASTER")
      expect(await (await getDocumentCatalog()).getById(writingId)).toMatchObject({ id: writingId })
      expect(await readWorkspaceMarkdown(), "el componente sigue bajo la misma identidad").toHaveLength(1)
      const writesAfterCommit = writeFileCalls().filter((call) => call.path === file.path).length
      expect(writesAfterCommit).toBe(writesBefore + 1)
      await advance(SAVE_WINDOW_MS)
      expect(writeFileCalls().filter((call) => call.path === file.path)).toHaveLength(writesAfterCommit)
      expect(await contentsOf(file.path)).toBe(durable)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "failNextBulkDualWrite rechaza atómicamente una proyección de metadata, fuera de la ruta de contenido",
    async () => {
      const { file, writingId } = await createMasterDocument()
      const contentsBefore = await contentsOf(file.path)
      const catalog = await getDocumentCatalog()
      const rowBefore = await catalog.getById(writingId)
      if (!rowBefore) throw new Error("El maestro no tiene fila de catálogo")
      const mutationsBefore = catalogMutationsDouble(dbPath()).filter((mutation) => mutation.documentId === writingId)
      failNextBulkDualWrite(() => {
        throw new Error("bulk catalog transaction failed")
      })

      const result = await (await getDocumentService()).updateWritingMetadata({
        writingId,
        status: "review",
        version: (rowBefore.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      })

      expect(result.data).toBeNull()
      expect(result.error?.message).toContain("bulk catalog transaction failed")
      expect(await contentsOf(file.path), "metadata no toca el archivo de contenido").toBe(contentsBefore)
      expect((await catalog.getById(writingId))?.status).toBe(rowBefore.status)
      expect((await catalog.getById(writingId))?.version).toBe(rowBefore.version)
      expect(catalogMutationsDouble(dbPath()).filter((mutation) => mutation.documentId === writingId)).toEqual(
        mutationsBefore,
      )
      expect(activeWritingId()).toBe(writingId)
      expect(await readWorkspaceMarkdown()).toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )
})
