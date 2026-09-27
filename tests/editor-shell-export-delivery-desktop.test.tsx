/**
 * @vitest-environment happy-dom
 *
 * @contract EXP-05 (ODE-601) — el éxito de un export solo se muestra si el
 * artefacto quedó escrito en disco.
 *
 * Cierra la costura interna que dejaban abierta
 * `tests/lib/services/desktop/export-delivery.test.ts` (escritor real contra
 * fs real) y `tests/components/properties-panel-export.test.tsx` (reacción del
 * panel a callbacks fakeados): aquí las dos mitades van conectadas en una sola
 * cadena, desde la shell montada.
 *
 * Camino de producción: "New Artifact" real, escritura real, `.md` real en
 * disco, apertura por ruta; botón "Properties panel" real → "Export as…" →
 * ítem del formato. De ahí, los callers reales de la shell (`exportMarkdown` /
 * `exportBinary`) → `DesktopDocumentService.exportWriting` real (PDF/Word,
 * render real desde el `.md` en disco) → `saveBinaryArtifact` real →
 * `saveDesktopBinaryExport` real → escritura real en un directorio temporal
 * (doble de `write_binary_file` en `real-desktop-doubles.ts`, que replica el
 * comando Rust, incluido su rechazo con un string).
 *
 * Solo se fakea el diálogo nativo de guardado (`world.saveDialogResult`), que
 * es un boundary externo real. PDF y Word exigen un documento confirmado por
 * la nube (`lifecycle === "server-confirmed"`); el servicio de sync es el
 * boundary doblado, así que su efecto se reproduce como lo escribe en SQLite:
 * `applyCloudSnapshots` del catálogo real, con `cloudAccountId`. Después el
 * documento se reabre por ruta, como desde Desk.
 *
 * Evento de completitud: el archivo en el directorio de exports y el mensaje
 * del panel en el DOM. Cada formato afirma primero el caso de éxito (control
 * positivo: el archivo aparece) antes de afirmar la ausencia en cancelar y en
 * error de escritura.
 *
 * Mutation tests (ODE-601), verificados en vivo, cada uno en rojo por su razón:
 * - `exportBinary` devuelve `undefined` en vez del booleano de
 *   `saveBinaryArtifact` → rojo PDF y Word (no aparece el éxito).
 * - `exportMarkdown`, igual → rojo Markdown.
 * - `saveDesktopBinaryExport` devuelve `true` sin escribir → rojo el éxito
 *   (ENOENT: el archivo no existe).
 * - `saveDesktopBinaryExport` devuelve `true` al cancelar el diálogo → rojo el
 *   cancelar (aparece "export generated.").
 *
 * Fuera de esta prueba, con motivo: `exportBinary` sin `currentWritingId`
 * (bug 1 de EXP-05) no es alcanzable por la UI — el ítem está deshabilitado
 * sin documento confirmado —, y el export de Desk (`WritingPreviewModal`) es
 * otro caller con su propio gap (ver la fila EXP-05).
 */
import { mkdtempSync, rmSync } from "node:fs"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("next/navigation", async () =>
  (await import("./support/editor-shell-doubles")).nextNavigationDouble(),
)
vi.mock("@tauri-apps/api/event", async () =>
  (await import("./support/editor-shell-doubles")).tauriEventDouble(),
)
vi.mock("@tauri-apps/plugin-dialog", async () =>
  (await import("./support/editor-shell-doubles")).tauriDialogDouble(),
)
vi.mock("@/lib/services/desktop/runtime-detection", async () =>
  (await import("./support/editor-shell-doubles")).runtimeDetectionDouble(),
)
vi.mock("@/lib/services/ai-service-factory", async () =>
  (await import("./support/editor-shell-doubles")).aiServiceDouble(),
)
vi.mock("@tauri-apps/api/path", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriPathDouble(),
)
vi.mock("@/lib/services/desktop/tauri-commands", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriCommandsDouble(),
)
vi.mock("@/lib/sync/sync-service-factory", async () =>
  (await import("./support/editor-shell-desktop-doubles")).syncServiceDouble(),
)

const {
  advance,
  assertNoUnhandledErrors,
  clickNewArtifact,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
  world,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, resetDesktopWorkspace } = await import(
  "./support/editor-shell-desktop-doubles"
)
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { act } = await import("react")

const TEST_TIMEOUT_MS = 90_000

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let exportsRoot: string

beforeAll(() => {
  createDesktopWorkspace("odessay-export-delivery-shell-")
  // Fuera del workspace: un `.md` exportado no debe mezclarse con los
  // documentos que lee `readWorkspaceMarkdown`.
  exportsRoot = mkdtempSync(join(tmpdir(), "odessay-export-delivery-target-"))
})

afterAll(() => {
  destroyDesktopWorkspace()
  rmSync(exportsRoot, { recursive: true, force: true })
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

type Format = "markdown" | "pdf" | "docx"

const ITEM_LABEL: Record<Format, string> = {
  markdown: "Markdown (.md)",
  pdf: "PDF (.pdf)",
  docx: "Word (.docx)",
}

const SUCCESS_MESSAGE: Record<Format, string> = {
  markdown: "Markdown export generated.",
  pdf: "PDF export generated.",
  docx: "Word export generated.",
}

// `invoke` rechaza con el string del comando, no con un `Error`: el panel cae
// en su mensaje de respaldo, que es lo que ve el usuario en producción.
const FAILURE_MESSAGE: Record<Format, string> = {
  markdown: "Failed to export Markdown.",
  pdf: "Failed to export PDF.",
  docx: "Failed to export Word.",
}

const SUCCESS_MESSAGES = Object.values(SUCCESS_MESSAGE)

function pageText() {
  return document.body.textContent ?? ""
}

/** Monta la shell y espera a que cargue la sesión (ver ODE-574, carrera de arranque). */
async function mountLoaded() {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
}

/**
 * Crea un documento real y lo reabre por ruta (remontaje por `key`, como una
 * entrada desde Desk), el mismo camino que `editor-shell-durable-save-state`.
 */
async function createAndOpenDocument(text: string) {
  await mountLoaded()
  await clickNewArtifact(mounted!.container)
  await typeInEditor(text)
  await advance(6_000)
  await waitForMarkdownContaining(text)
  const writingId = await waitFor(
    () => getEditorSessionState().session.tabs.find((tab) => tab.writing_id)?.writing_id ?? null,
    { label: "documento materializado", timeoutMs: 15_000 },
  )
  await reopen(writingId, text, writingId)
  return writingId
}

async function reopen(writingId: string, text: string, key: string) {
  await mounted!.render({ key, writingId })
  await waitFor(() => mounted!.editor().getText().includes(text), { label: "documento abierto por ruta" })
  await flush(3)
}

/**
 * El efecto del servicio de sync (boundary doblado) al confirmar el INSERT en
 * la nube: el snapshot con la cuenta dueña. Con eso la fila deja de ser
 * local-only y el documento se hidrata `server-confirmed`.
 */
async function confirmInCloud(writingId: string, text: string) {
  const catalog = (await getDocumentCatalog()) as Awaited<ReturnType<typeof getDocumentCatalog>> & {
    applyCloudSnapshots: (snapshots: unknown[]) => Promise<void>
  }
  const record = await catalog.getById(writingId)
  if (!record) throw new Error(`Sin fila de catálogo para ${writingId}`)
  await act(async () => {
    await catalog.applyCloudSnapshots([
      {
        id: record.id,
        cloudPresent: true,
        cloudAccountId: "cloud-account",
        syncStatus: record.syncStatus,
        title: record.title,
        slug: record.slug,
        status: record.status,
        artifactType: record.artifactType,
        visibility: record.visibility,
        version: record.version,
        deletedAt: record.deletedAt,
        createdAt: record.createdAt,
        modifiedAt: record.modifiedAt,
      },
    ])
  })
  await flush(3)
  await reopen(writingId, text, `${writingId}:cloud`)
}

function findButton(root: ParentNode, predicate: (button: HTMLButtonElement) => boolean) {
  return Array.from(root.querySelectorAll("button")).find(predicate) ?? null
}

/**
 * Abre la sección Export con la UI real: el botón "Properties panel" de la
 * barra superior abre el panel lateral y su pestaña "Share" muestra Export
 * (se movió ahí en la revisión del owner; ver `PropertiesPanel.tab`).
 */
async function openExportSection() {
  const exportTrigger = () =>
    findButton(mounted!.container, (button) => button.textContent?.includes("Export as…") ?? false)
  if (exportTrigger()) return
  const toggle = await waitFor(
    () => findButton(mounted!.container, (button) => button.getAttribute("aria-label") === "Properties panel"),
    { label: 'botón "Properties panel"' },
  )
  if (toggle.getAttribute("aria-pressed") !== "true") {
    await act(async () => {
      toggle.click()
    })
    await flush(2)
  }
  const shareTab = await waitFor(
    () =>
      findButton(
        mounted!.container,
        (button) => button.getAttribute("role") === "tab" && button.textContent?.trim() === "Share",
      ),
    { label: 'pestaña "Share" del panel' },
  )
  await act(async () => {
    shareTab.click()
  })
  await flush(2)
  await waitFor(exportTrigger, { label: 'sección Export con "Export as…"' })
}

/**
 * Dispara el export por la UI real: "Export as…" abre el popover (portal en
 * `document.body`) y se pulsa el ítem del formato. El driver verifica que el
 * ítem está habilitado; si no, el export no ocurrió y el test no puede
 * afirmar nada.
 */
async function exportVia(format: Format) {
  await openExportSection()
  const trigger = findButton(mounted!.container, (button) => button.textContent?.includes("Export as…") ?? false)!
  await act(async () => {
    trigger.click()
  })
  await flush(2)
  const item = await waitFor(
    () => findButton(document.body, (button) => button.textContent?.trim() === ITEM_LABEL[format]),
    { label: `ítem "${ITEM_LABEL[format]}"` },
  )
  expect(item.disabled, `el ítem "${ITEM_LABEL[format]}" está habilitado`).toBe(false)
  const dialogCallsBefore = world.saveDialogCalls.length
  await act(async () => {
    item.click()
  })
  await waitFor(() => world.saveDialogCalls.length > dialogCallsBefore, {
    label: "diálogo nativo de guardado invocado",
    timeoutMs: 20_000,
  })
  return world.saveDialogCalls[world.saveDialogCalls.length - 1]
}

/**
 * Deja asentar el export tras el diálogo. En cancelar no hay evento positivo
 * que esperar (esa es justo la propiedad): tras el diálogo solo quedan
 * microtareas hasta el `finally` del panel, y el mutation test "devolver
 * `true` sin escribir" confirma que esta espera alcanza para ver el éxito
 * falso si aparece.
 */
async function waitForExportSettled() {
  await advance(200)
  await flush(3)
}

async function listExports(dir: string) {
  return readdir(dir).catch(() => [] as string[])
}

function freshDir(name: string) {
  return mkdtempSync(join(exportsRoot, `${name}-`))
}

/**
 * Los tres casos de un formato sobre el mismo documento abierto: éxito
 * (control positivo), cancelar y error real de escritura.
 */
async function assertExportChain(format: Format, fileName: string, verifyBytes: (bytes: Buffer) => void) {
  // 1. Éxito: el artefacto existe en disco y la UI lo reporta.
  const successDir = freshDir(`${format}-success`)
  const target = join(successDir, fileName)
  world.saveDialogResult = target
  const options = await exportVia(format)
  expect(String(options?.defaultPath ?? ""), "el diálogo propone el nombre del export").toMatch(
    new RegExp(`\\.${format === "markdown" ? "md" : format}$`),
  )
  await waitFor(() => pageText().includes(SUCCESS_MESSAGE[format]), {
    label: `"${SUCCESS_MESSAGE[format]}" en el DOM`,
    timeoutMs: 20_000,
  })
  verifyBytes(await readFile(target))
  expect(await listExports(successDir), "solo el artefacto, sin `.tmp`").toEqual([fileName])
  expect(pageText()).not.toContain(FAILURE_MESSAGE[format])

  // 2. Cancelar el diálogo: sin artefacto y sin éxito.
  const cancelDir = freshDir(`${format}-cancel`)
  world.saveDialogResult = null
  await exportVia(format)
  await waitForExportSettled()
  expect(await listExports(cancelDir), "cancelar no escribe nada").toEqual([])
  for (const message of SUCCESS_MESSAGES) expect(pageText(), "cancelar no reporta éxito").not.toContain(message)
  expect(pageText(), "cancelar no es un error").not.toContain(FAILURE_MESSAGE[format])

  // 3. Error real de escritura: la "carpeta" elegida es un archivo.
  const failureDir = freshDir(`${format}-failure`)
  const blocker = join(failureDir, "not-a-directory")
  await writeFile(blocker, "occupied")
  world.saveDialogResult = join(blocker, fileName)
  await exportVia(format)
  await waitFor(() => pageText().includes(FAILURE_MESSAGE[format]), {
    label: `"${FAILURE_MESSAGE[format]}" en el DOM`,
    timeoutMs: 20_000,
  })
  expect(await listExports(failureDir), "el fallo no deja artefacto").toEqual(["not-a-directory"])
  for (const message of SUCCESS_MESSAGES) expect(pageText(), "el fallo no reporta éxito").not.toContain(message)

  // El error se muestra en el panel: no se lo tragó nadie por el camino.
  assertNoUnhandledErrors()
}

describe("EXP-05 — export desde la shell hasta el disco (ODE-601)", () => {
  it(
    "Markdown: éxito escribe el cuerpo; cancelar y error de escritura no reportan éxito",
    async () => {
      const text = "ODE601-MARKDOWN-BODY"
      await createAndOpenDocument(text)

      await assertExportChain("markdown", "letter.md", (bytes) => {
        expect(bytes.toString("utf8")).toContain(text)
      })
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "PDF: éxito escribe un PDF real; cancelar y error de escritura no reportan éxito",
    async () => {
      const text = "ODE601-PDF-BODY"
      const writingId = await createAndOpenDocument(text)
      await confirmInCloud(writingId, text)

      await assertExportChain("pdf", "letter.pdf", (bytes) => {
        expect(bytes.subarray(0, 5).toString("latin1"), "cabecera PDF").toBe("%PDF-")
      })
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "Word: éxito escribe un .docx real; cancelar y error de escritura no reportan éxito",
    async () => {
      const text = "ODE601-DOCX-BODY"
      const writingId = await createAndOpenDocument(text)
      await confirmInCloud(writingId, text)

      await assertExportChain("docx", "letter.docx", (bytes) => {
        // Un .docx es un zip: firma local-file-header "PK\x03\x04".
        expect([...bytes.subarray(0, 4)], "firma zip del .docx").toEqual([0x50, 0x4b, 0x03, 0x04])
      })
    },
    TEST_TIMEOUT_MS,
  )
})
