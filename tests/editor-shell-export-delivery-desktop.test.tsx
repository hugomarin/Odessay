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
 * - `saveDesktopBinaryExport` devuelve `true` sin escribir → rojo el éxito
 *   (ENOENT: el archivo no existe).
 * - `saveDesktopBinaryExport` devuelve `true` al cancelar el diálogo → rojo el
 *   cancelar (aparece el toast de éxito).
 *
 * ODE-652 (EXP-05, atribución): el éxito y el error de PDF/Word se reportan en
 * un toast que nombra el documento que inició la exportación, y el aviso
 * sobrevive al cambio de pestaña. Markdown deja de ofrecerse en el menú
 * Exportar (decisión G): Guardar y "Copy as Markdown" son acciones distintas y
 * permanecen. Las mutaciones de esa protección están en la Guía de review del
 * PR; la discriminante es del lado del aviso, no de los bytes.
 *
 * ODE-652 / SHARE-03 (decisión D): una respuesta tardía del enlace de A no
 * reemplaza el enlace activo de B ni su "Copy", y el toast "Share link for ‘A’
 * is ready" sigue nombrando a A. El servicio de compartir es el boundary
 * doblado de esta prueba: no demuestra que un token real resuelva ni autoriza
 * acceso, y ese límite queda anotado en la fila SHARE-03 del capability map.
 * Las mutaciones de esta protección están en la Guía de review del PR.
 *
 * Fuera de esta prueba, con motivo: `exportBinary` sin `currentWritingId`
 * (bug 1 de EXP-05) no es alcanzable por la UI — el ítem está deshabilitado
 * sin documento confirmado —, y el export de Desk (`WritingPreviewModal`) es
 * otro caller con su propio gap (ver la fila EXP-05).
 *
 * @contract EXP-05 (ODE-636) — the production Desk and Collections Markdown callers
 * reach the same artifact writer, and a reported success follows a real file write.
 * The mounted-page proof covers preview and row-menu flows; D1 failure/cancel outcomes
 * and D3 Desk body content are asserted in separate tests so each it.fails commit
 * names one failure mode without coupling the fixes.
 */
import { mkdtempSync, rmSync, unlinkSync } from "node:fs"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import JSZip from "jszip"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
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
vi.mock("@/lib/runtime/detect", async () =>
  (await import("./support/editor-shell-doubles")).tauriRuntimeDetectDouble(),
)
vi.mock("@/lib/services/ai-service-factory", async () =>
  (await import("./support/editor-shell-doubles")).aiServiceDouble(),
)
vi.mock("@/lib/services/sharing-service-factory", async () =>
  (await import("./support/editor-shell-doubles")).sharingServiceDouble(),
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
  clickEditorTab,
  clickNewArtifact,
  emitTauriEvent,
  flush,
  installNetworkDouble,
  mountEditorShell,
  pointerClick,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForAsync,
  waitForHydrationReady,
  waitForMarkdownContaining,
  world,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, resetDesktopWorkspace } = await import(
  "./support/editor-shell-desktop-doubles"
)
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { getDocumentService } = await import("@/lib/services/document-service-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { act } = await import("react")

const TEST_TIMEOUT_MS = 90_000

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let pageRoot: Root | null = null
let pageContainer: HTMLDivElement | null = null
let exportsRoot: string

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ode636-test.supabase.co")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY", "ode636-public-test-key")
  createDesktopWorkspace("odessay-export-delivery-shell-")
  // Fuera del workspace: un `.md` exportado no debe mezclarse con los
  // documentos que lee `readWorkspaceMarkdown`.
  exportsRoot = mkdtempSync(join(tmpdir(), "odessay-export-delivery-target-"))
})

afterAll(() => {
  destroyDesktopWorkspace()
  rmSync(exportsRoot, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
})

afterEach(async () => {
  if (pageRoot) {
    await act(async () => pageRoot?.unmount())
    pageRoot = null
  }
  pageContainer?.remove()
  pageContainer = null
  await mounted?.unmount()
  mounted = null
})

type Format = "markdown" | "pdf" | "docx"

const ITEM_LABEL: Record<Format, string> = {
  markdown: "Markdown (.md)",
  pdf: "PDF (.pdf)",
  docx: "Word (.docx)",
}

type PanelFormat = "pdf" | "docx"

const PANEL_ITEM_LABEL: Record<PanelFormat, string> = {
  pdf: "PDF (.pdf)",
  docx: "Word (.docx)",
}

const EXPORT_LABEL: Record<PanelFormat, string> = {
  pdf: "PDF",
  docx: "Word",
}

/**
 * Copy del toast del panel (ODE-652): qué ocurrió + nombre del documento de
 * origen. Un rechazo con `Error` añade el detalle tras `failed: `; el string
 * crudo de Tauri (producción) cae en el mensaje sin detalle.
 */
const panelSuccessMessage = (format: PanelFormat, title: string) =>
  `${EXPORT_LABEL[format]} export for ‘${title}’ is ready`

const panelFailureMessage = (format: PanelFormat, title: string) =>
  `${EXPORT_LABEL[format]} export for ‘${title}’ failed`

function documentActionToast(kind: "success" | "error") {
  const notice = document.querySelector<HTMLElement>('[data-testid="document-action-toast"]')
  return notice?.getAttribute("data-notice") === kind ? notice : null
}

async function waitForDocumentActionToast(kind: "success" | "error") {
  return waitFor(() => documentActionToast(kind), { label: `toast de export ${kind}` })
}

function pageText() {
  return document.body.textContent ?? ""
}

async function mountProductionPage(node: ReactNode) {
  pageContainer = document.createElement("div")
  document.body.appendChild(pageContainer)
  pageRoot = createRoot(pageContainer)
  await act(async () => {
    pageRoot!.render(node)
  })
  await flush(3)
}

async function unmountEditorBeforeDeskSurface() {
  await mounted?.unmount()
  mounted = null
  await flush(2)
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
 * Segundo documento en la MISMA montura de shell (patrón `alreadyOpen` de
 * `editor-shell-durable-save-state`): `createAndOpenDocument` devuelve el
 * primero cuando ya hay dos pestañas abiertas.
 */
async function createAndOpenSecondDocument(text: string) {
  const alreadyOpen = new Set(
    getEditorSessionState().session.tabs
      .map((tab) => tab.writing_id)
      .filter((writingId): writingId is string => Boolean(writingId)),
  )
  await clickNewArtifact(mounted!.container)
  await typeInEditor(text)
  await advance(6_000)
  await waitForMarkdownContaining(text)
  const writingId = await waitFor(
    () => {
      const tab = getEditorSessionState().session.tabs.find(
        (candidate) => candidate.writing_id && !alreadyOpen.has(candidate.writing_id),
      )
      return tab?.writing_id ?? null
    },
    { label: "segundo documento materializado", timeoutMs: 15_000 },
  )
  await reopen(writingId, text, writingId)
  return writingId
}

/** Texto del `word/document.xml` de un .docx real (JSZip). */
async function readDocxDocumentXml(bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes)
  const documentXml = zip.file("word/document.xml")
  if (!documentXml) throw new Error("El .docx no contiene word/document.xml")
  return documentXml.async("string")
}

function renameInput() {
  return document.querySelector<HTMLInputElement>('input[aria-label="Artifact name"]')
}

/** Renombra la pestaña activa por el modal real (driver canónico de ODE-604). */
async function renameActiveDocument(title: string) {
  const session = getEditorSessionState().session
  const active = session.tabs.find((tab) => tab.id === session.active_tab_id)
  if (!active) throw new Error("No hay pestaña activa para renombrar")
  const pencil = document
    .querySelector<HTMLElement>(`[data-editor-tab-id="${active.id}"]`)
    ?.querySelector<HTMLElement>('button[aria-label^="Rename"]')
  if (!pencil) throw new Error("La pestaña activa no tiene lápiz de renombrar")
  await pointerClick(pencil)
  const input = await waitFor(() => renameInput(), { label: "modal de renombrado abierto" })
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, title)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  const save = await waitFor(
    () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="button"]')).find(
        (button) => (button.textContent ?? "").trim() === "Save name",
      ),
    { label: 'botón "Save name"' },
  )
  await act(async () => {
    save.click()
  })
  await flush(2)
}

/**
 * Dos documentos con título explícito y confirmados por la nube en la MISMA
 * montura: el nombre exportado y el nombre del toast distinguen A de B.
 */
async function openTwoAttributedDocuments(
  { text, title }: { text: string; title: string },
  second: { text: string; title: string },
) {
  const a = await createAndOpenDocument(text)
  await renameActiveDocument(title)
  await waitForAsync(async () => (await getCatalogRecord(a)).title === title, {
    label: `título de A persistido (${title})`,
  })
  await confirmInCloud(a, text)

  const b = await createAndOpenSecondDocument(second.text)
  await renameActiveDocument(second.title)
  await waitForAsync(async () => (await getCatalogRecord(b)).title === second.title, {
    label: `título de B persistido (${second.title})`,
  })
  await confirmInCloud(b, second.text)
  return { a, b }
}

/** Convierte el `canonicalPath` de un documento en el nombre del export. */
function exportedFileName(canonicalPath: string, extension: "docx") {
  const base = canonicalPath.split("/").pop()
  if (!base) throw new Error(`Ruta canónica sin nombre: ${canonicalPath}`)
  return `${base.replace(/\.md$/, "")}.${extension}`
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

async function openProductionPreview(surface: "desk" | "collections", writingId: string) {
  const record = await (await getDocumentCatalog()).getById(writingId)
  if (!record) throw new Error(`Sin fila de catálogo para ${writingId}`)

  await mountProductionSurface(surface)

  const preview = await waitFor(
    () =>
      findButton(
        pageContainer!,
        (button) => button.getAttribute("aria-label") === `Preview ${record.title}`,
      ),
    { label: `${surface} row for ${record.title}` },
  )
  await act(async () => preview.click())
  await flush(3)

  const exportTrigger = await waitFor(
    () => findButton(document.body, (button) => button.textContent?.includes("Export as…") ?? false),
    { label: `${surface} preview export trigger` },
  )
  await act(async () => exportTrigger.click())
  await flush(2)

  return record
}

async function mountProductionSurface(surface: "desk" | "collections") {
  installNetworkDouble()
  await unmountEditorBeforeDeskSurface()
  if (surface === "desk") {
    world.pathname = "/desk"
    const { default: DeskPage } = await import("@/app/(app)/desk/page")
    await mountProductionPage(<DeskPage />)
  } else {
    const { CollectionsView } = await import("@/components/collections/collections-view")
    const { UNCATEGORIZED_COLLECTION_ID } = await import("@/lib/collections/collections")
    await mountProductionPage(
      <CollectionsView initialExpandedCollectionId={UNCATEGORIZED_COLLECTION_ID} />,
    )
  }
}

async function selectProductionRow(title: string) {
  const checkbox = await waitFor(
    () =>
      findButton(pageContainer!, (button) => button.getAttribute("aria-label") === `Select ${title}`),
    { label: `checkbox para seleccionar ${title}` },
  )
  await act(async () => checkbox.click())
  await waitFor(() => document.querySelector('[data-selection-bar="true"]'), {
    label: "SelectionBar visible",
  })
}

async function clickProductionRowMenuItem(title: string, label: string) {
  const trigger = await waitFor(
    () => findButton(pageContainer!, (button) => button.getAttribute("aria-label") === `Actions for ${title}`),
    { label: `menú de acciones para ${title}` },
  )
  await pointerClick(trigger)
  const item = await waitFor(
    () =>
      Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (menuItem) => menuItem.textContent?.trim() === label,
      ) ?? null,
    { label: `ítem de menú ${label}` },
  )
  await act(async () => item.click())
  await flush(2)
}

async function clickProductionRowDownload(title: string) {
  await clickProductionRowMenuItem(title, "Download markdown")
}

async function getCatalogRecord(writingId: string) {
  const record = await (await getDocumentCatalog()).getById(writingId)
  if (!record) throw new Error(`Sin fila de catálogo para ${writingId}`)
  return record
}

async function waitForSaveDialogCall(previousCount: number, label: string) {
  await waitFor(() => world.saveDialogCalls.length === previousCount + 1, {
    label,
    timeoutMs: 10_000,
  })
}

async function waitForExportNotice(kind: "success" | "error") {
  return waitFor(
    () => {
      const notice = document.querySelector<HTMLElement>('[data-testid="markdown-export-notice"]')
      return notice?.getAttribute("data-notice") === kind ? notice : null
    },
    { label: `aviso Markdown ${kind}` },
  )
}

async function clickPreviewExport(format: Format) {
  const itemIsOpen = () =>
    findButton(document.body, (button) => button.textContent?.trim() === ITEM_LABEL[format])
  if (!itemIsOpen()) {
    const trigger = await waitFor(
      () => findButton(document.body, (button) => button.textContent?.includes("Export as…") ?? false),
      { label: "trigger Export as… del preview" },
    )
    await act(async () => trigger.click())
    await flush(2)
  }
  const item = await waitFor(
    itemIsOpen,
    { label: `preview menu item ${ITEM_LABEL[format]}` },
  )
  expect(item.disabled, `preview menu item ${ITEM_LABEL[format]} is enabled`).toBe(false)
  await act(async () => item.click())
  await flush(4)
}

/**
 * Abre el panel lateral en su pestaña "Share" con el gesto real: el botón
 * "Properties panel" de la barra superior y la pestaña homónima.
 */
async function openShareTab() {
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
  await openShareTab()
  await waitFor(exportTrigger, { label: 'sección Export con "Export as…"' })
}

type SharePreviewLink = {
  active: boolean
  token: string | null
  link: string | null
  createdAt: string | null
}

function previewLink(link: string): SharePreviewLink {
  return { active: true, token: link, link, createdAt: "2026-10-02T00:00:00.000Z" }
}

function shareActionButton(label: "Generate link" | "Regenerate" | "Copy") {
  return findButton(mounted!.container, (button) => button.textContent?.trim() === label)
}

/** Pulsa la acción del preview link con el botón real y verifica que ocurrió. */
async function clickShareAction(label: "Generate link" | "Regenerate" | "Copy") {
  const button = await waitFor(() => shareActionButton(label), {
    label: `botón "${label}" del preview link`,
  })
  expect(button.disabled, `el botón "${label}" está habilitado`).toBe(false)
  await act(async () => {
    button.click()
  })
  await flush(3)
}

async function waitForShareLinkText(text: string) {
  await waitFor(() => pageText().includes(text), { label: `enlace de compartir visible (${text})` })
}

/** El toast es el evento de completitud del resultado de compartir. */
async function waitForShareToast() {
  return waitFor(() => documentActionToast("success"), {
    label: "toast de enlace de compartir",
    timeoutMs: 10_000,
  })
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

async function assertProductionPreviewExportChain(
  format: Exclude<Format, "markdown">,
  fileName: string,
  verifyBytes: (bytes: Buffer) => void,
) {
  const successDir = freshDir(`desk-preview-${format}-success`)
  const target = join(successDir, fileName)
  const successMessage = `${format.toUpperCase()} exported.`
  const failureMessage = `Failed to export ${format.toUpperCase()}.`
  world.saveDialogResult = target
  const successDialogCount = world.saveDialogCalls.length
  await clickPreviewExport(format)
  await waitForSaveDialogCall(successDialogCount, `diálogo de Desk para ${format}`)
  await waitFor(() => pageText().includes(successMessage), {
    label: `éxito ${successMessage} en el preview de Desk`,
    timeoutMs: 20_000,
  })
  expect(String(world.saveDialogCalls.at(-1)?.defaultPath ?? "")).toMatch(new RegExp(`\\.${format}$`))
  verifyBytes(await readFile(target))
  expect(await listExports(successDir)).toEqual([fileName])
  expect(pageText()).not.toContain(failureMessage)

  const cancelDir = freshDir(`desk-preview-${format}-cancel`)
  world.saveDialogResult = null
  const cancelDialogCount = world.saveDialogCalls.length
  await clickPreviewExport(format)
  await waitForSaveDialogCall(cancelDialogCount, `diálogo de Desk cancelado para ${format}`)
  await waitForExportSettled()
  expect(await listExports(cancelDir)).toEqual([])
  expect(pageText()).not.toContain(successMessage)
  expect(pageText()).not.toContain(failureMessage)

  const failureDir = freshDir(`desk-preview-${format}-failure`)
  const blocker = join(failureDir, "not-a-directory")
  await writeFile(blocker, "occupied")
  world.saveDialogResult = join(blocker, fileName)
  const failureDialogCount = world.saveDialogCalls.length
  await clickPreviewExport(format)
  await waitForSaveDialogCall(failureDialogCount, `diálogo de Desk con fallo al escribir ${format}`)
  await waitFor(() => pageText().includes(failureMessage), {
    label: `fallo ${failureMessage} en el preview de Desk`,
    timeoutMs: 20_000,
  })
  expect(await listExports(failureDir)).toEqual(["not-a-directory"])
  expect(pageText()).not.toContain(successMessage)
  assertNoUnhandledErrors()
}

async function assertProductionPreviewMarkdownChain(surface: "desk" | "collections", text: string) {
  const successDir = freshDir(`${surface}-preview-markdown-success`)
  const fileName = `${surface}-letter.md`
  const target = join(successDir, fileName)
  world.saveDialogResult = target
  const successDialogCount = world.saveDialogCalls.length
  await clickPreviewExport("markdown")
  await waitFor(() => pageText().includes("Markdown exported."), {
    label: `${surface} Markdown preview success`,
  })
  expect(world.saveDialogCalls).toHaveLength(successDialogCount + 1)
  expect(await listExports(successDir)).toEqual([fileName])
  expect((await readFile(target)).toString("utf8")).toContain(text)

  const cancelDir = freshDir(`${surface}-preview-markdown-cancel`)
  world.saveDialogResult = null
  const cancelDialogCount = world.saveDialogCalls.length
  await clickPreviewExport("markdown")
  await waitForSaveDialogCall(cancelDialogCount, `${surface} canceled Markdown dialog`)
  await waitForExportSettled()
  expect(await listExports(cancelDir)).toEqual([])
  expect(pageText()).not.toContain("Markdown exported.")
  expect(pageText()).not.toContain("Failed to export Markdown.")

  const failureDir = freshDir(`${surface}-preview-markdown-failure`)
  const blocker = join(failureDir, "not-a-directory")
  await writeFile(blocker, "occupied")
  world.saveDialogResult = join(blocker, fileName)
  const failureDialogCount = world.saveDialogCalls.length
  await clickPreviewExport("markdown")
  await waitForSaveDialogCall(failureDialogCount, `${surface} Markdown write-failure dialog`)
  await waitFor(() => pageText().includes("Failed to export Markdown."), {
    label: `${surface} Markdown preview write error`,
  })
  expect(await listExports(failureDir)).toEqual(["not-a-directory"])
  expect(pageText()).not.toContain("Markdown exported.")
  assertNoUnhandledErrors()
}

async function listExports(dir: string) {
  return readdir(dir).catch(() => [] as string[])
}

function freshDir(name: string) {
  return mkdtempSync(join(exportsRoot, `${name}-`))
}

/**
 * Los tres casos de un formato del panel sobre el mismo documento abierto:
 * éxito (control positivo, con el toast atribuido), cancelar y error real de
 * escritura.
 */
async function assertExportChain(
  format: PanelFormat,
  title: string,
  fileName: string,
  verifyBytes: (bytes: Buffer) => void,
) {
  // 1. Éxito: el artefacto existe en disco y el toast nombra el origen.
  const successDir = freshDir(`${format}-success`)
  const target = join(successDir, fileName)
  world.saveDialogResult = target
  const options = await exportVia(format)
  expect(String(options?.defaultPath ?? ""), "el diálogo propone el nombre del export").toMatch(
    new RegExp(`\\.${format}$`),
  )
  const successToast = await waitForDocumentActionToast("success")
  expect(successToast.textContent, "el toast nombra el documento de origen").toBe(
    panelSuccessMessage(format, title),
  )
  verifyBytes(await readFile(target))
  expect(await listExports(successDir), "solo el artefacto, sin `.tmp`").toEqual([fileName])

  // 2. Cancelar el diálogo: sin artefacto y sin toast.
  const cancelDir = freshDir(`${format}-cancel`)
  world.saveDialogResult = null
  await exportVia(format)
  await waitForExportSettled()
  expect(await listExports(cancelDir), "cancelar no escribe nada").toEqual([])
  expect(documentActionToast("success"), "cancelar no reporta éxito").toBeNull()
  expect(documentActionToast("error"), "cancelar no es un error").toBeNull()

  // 3. Error real de escritura: la "carpeta" elegida es un archivo. `invoke`
  // rechaza con el string del comando, no con un `Error`: el panel cae en su
  // mensaje de respaldo, que conserva el documento de origen.
  const failureDir = freshDir(`${format}-failure`)
  const blocker = join(failureDir, "not-a-directory")
  await writeFile(blocker, "occupied")
  world.saveDialogResult = join(blocker, fileName)
  await exportVia(format)
  const failureToast = await waitForDocumentActionToast("error")
  expect(failureToast.textContent, "el error conserva el documento de origen").toBe(
    panelFailureMessage(format, title),
  )
  expect(await listExports(failureDir), "el fallo no deja artefacto").toEqual(["not-a-directory"])

  // El error se muestra en el panel: no se lo tragó nadie por el camino.
  assertNoUnhandledErrors()
}

describe("EXP-05 — export desde la shell hasta el disco (ODE-601)", () => {
  it(
    "PDF: éxito escribe un PDF real; cancelar y error de escritura no reportan éxito",
    async () => {
      const text = "ODE601-PDF-BODY"
      const writingId = await createAndOpenDocument(text)
      const catalogRecord = await (await getDocumentCatalog()).getById(writingId)
      const canonicalPath = catalogRecord?.binding?.canonicalPath
      expect(canonicalPath, "the catalog resolves the UUID to a file path").toBeTruthy()
      expect(canonicalPath).not.toBe(writingId)
      if (!canonicalPath) throw new Error("Expected the catalog to resolve a canonical file path")
      expect((await readFile(canonicalPath)).toString("utf8")).toContain(text)

      const downloaded = await (await getDocumentService()).downloadWriting({ writingId })
      expect(downloaded.error).toBeNull()
      if (!downloaded.data) throw new Error("Expected the desktop document download to return data")
      expect(downloaded.data.writingId).toBe(canonicalPath)
      expect(new TextDecoder().decode(downloaded.data.bytes)).toContain(text)

      await confirmInCloud(writingId, text)

      // El nombre del toast es el título visible del documento (derivado del
      // cuerpo cuando no hay título explícito), no la fila del catálogo.
      await assertExportChain("pdf", text, "letter.pdf", (bytes) => {
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

      await assertExportChain("docx", text, "letter.docx", (bytes) => {
        // Un .docx es un zip: firma local-file-header "PK\x03\x04".
        expect([...bytes.subarray(0, 4)], "firma zip del .docx").toEqual([0x50, 0x4b, 0x03, 0x04])
      })
    },
    TEST_TIMEOUT_MS,
  )
})

describe("EXP-05 — el resultado del export se atribuye al documento de origen (ODE-652)", () => {
  it(
    "carrera: el diálogo retenido, el cambio a B y la liberación conservan el aviso y los bytes de A",
    async () => {
      const textA = "ODE652-RACE-A"
      const textB = "ODE652-RACE-B"
      const titleA = "ODE652 Race A"
      const titleB = "ODE652 Race B"
      const { a, b } = await openTwoAttributedDocuments(
        { text: textA, title: titleA },
        { text: textB, title: titleB },
      )
      const canonicalA = (await getCatalogRecord(a)).binding?.canonicalPath
      if (!canonicalA) throw new Error("Expected a canonical path for A")
      const expectedFileName = exportedFileName(canonicalA, "docx")

      await clickEditorTab(a)
      await waitForHydrationReady("A activo antes del export")

      let releaseDialog: (value: string | null) => void = () => {
        throw new Error("el diálogo no quedó retenido")
      }
      const heldDialog = new Promise<string | null>((resolve) => {
        releaseDialog = resolve
      })
      world.saveDialogResult = heldDialog
      const raceDir = freshDir("ode652-race")
      const target = join(raceDir, "race.docx")

      try {
        await exportVia("docx")
        expect(
          String(world.saveDialogCalls.at(-1)?.defaultPath ?? ""),
          "el diálogo retenido propone el nombre de A",
        ).toBe(expectedFileName)

        // Cambio de pestaña con el export de A todavía en vuelo.
        await clickEditorTab(b)
        await waitForHydrationReady("B activo con el export de A en vuelo")
        expect(mounted!.editor().getText(), "control positivo: B es el documento activo").toContain(textB)

        // Se libera el diálogo de A: el resultado pertenece a A, no a B.
        releaseDialog(target)
        const toast = await waitForDocumentActionToast("success")
        expect(toast.textContent, "el toast nombra A aunque B esté seleccionado").toBe(
          panelSuccessMessage("docx", titleA),
        )
        expect(toast.textContent).not.toContain(titleB)
      } finally {
        releaseDialog(null)
      }

      // El artefacto escrito es el de A: bytes reales del .docx.
      const documentXml = await readDocxDocumentXml(await readFile(target))
      expect(documentXml, "el .docx contiene el cuerpo de A").toContain(textA)
      expect(documentXml, "el .docx no contiene el cuerpo de B").not.toContain(textB)
      expect(await listExports(raceDir)).toEqual(["race.docx"])
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "sin carrera: el toast nombra A y sigue visible al cambiar a B; Guardar sigue escribiendo el .md",
    async () => {
      const textA = "ODE652-NORACE-A"
      const textB = "ODE652-NORACE-B"
      const titleA = "ODE652 No Race A"
      const titleB = "ODE652 No Race B"
      const { a, b } = await openTwoAttributedDocuments(
        { text: textA, title: titleA },
        { text: textB, title: titleB },
      )
      const canonicalA = (await getCatalogRecord(a)).binding?.canonicalPath
      if (!canonicalA) throw new Error("Expected a canonical path for A")

      await clickEditorTab(a)
      await waitForHydrationReady("A activo antes del export")

      const successDir = freshDir("ode652-no-race")
      const target = join(successDir, "no-race.docx")
      world.saveDialogResult = target
      await exportVia("docx")
      const toast = await waitForDocumentActionToast("success")
      expect(toast.textContent, "control positivo: el toast aparece sin cambiar de pestaña").toBe(
        panelSuccessMessage("docx", titleA),
      )
      expect(await listExports(successDir)).toEqual(["no-race.docx"])

      // Guardar sigue funcionando: la acción nativa (menu:save-to-disk)
      // escribe el .md canónico. Markdown salió del menú Exportar, no Guardar.
      await typeInEditor(" ODE652-SAVED")
      const saveDir = freshDir("ode652-save")
      const saveTarget = join(saveDir, "ode652-no-race.md")
      world.saveDialogResult = saveTarget
      const saveDialogCalls = world.saveDialogCalls.length
      await emitTauriEvent("menu:save-to-disk")
      await waitFor(() => world.saveDialogCalls.length === saveDialogCalls + 1, {
        label: "diálogo de Guardar invocado",
        timeoutMs: 10_000,
      })
      await waitForAsync(
        async () => {
          const saved = await readFile(saveTarget).catch(() => null)
          return saved?.toString("utf8").includes("ODE652-SAVED") ?? false
        },
        { label: "el .md guardado contiene la edición", timeoutMs: 10_000 },
      )

      // Cambio de pestaña: el aviso de A sigue siendo el de A.
      await clickEditorTab(b)
      await waitForHydrationReady("B activo después del export de A")
      const retained = await waitForDocumentActionToast("success")
      expect(retained.textContent, "el aviso sigue atribuido a A").toBe(panelSuccessMessage("docx", titleA))
      expect(retained.textContent).not.toContain(titleB)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

const clipboardWrites: string[] = []

describe("EXP-05 — el enlace de compartir se atribuye al documento de origen (ODE-652 / SHARE-03)", () => {
  const LINK_A = "https://preview.odessay.test/ode652-share-a"
  const LINK_A_ROTATED = "https://preview.odessay.test/ode652-share-a-rotated"
  const LINK_A_STALE = "https://preview.odessay.test/ode652-share-a-stale"
  const LINK_B = "https://preview.odessay.test/ode652-share-b"

  beforeEach(() => {
    clipboardWrites.length = 0
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          clipboardWrites.push(text)
        },
      },
    })
  })

  it(
    "carrera: la respuesta tardía del enlace de A no reemplaza el de B y el toast nombra A",
    async () => {
      const textA = "ODE652-SHARE-RACE-A"
      const textB = "ODE652-SHARE-RACE-B"
      const titleA = "ODE652 Share Race A"
      const titleB = "ODE652 Share Race B"
      const { a, b } = await openTwoAttributedDocuments(
        { text: textA, title: titleA },
        { text: textB, title: titleB },
      )

      // El enlace activo de cada documento lo sirve el boundary doblado.
      world.getPreviewLink = async (writingId) => ({
        error: null,
        data: writingId === a ? previewLink(LINK_A) : writingId === b ? previewLink(LINK_B) : null,
      })
      let releaseRotate: (value: { error: unknown; data: SharePreviewLink | null }) => void = () => {
        throw new Error("la respuesta del enlace de A no quedó retenida")
      }
      const heldRotate = new Promise<{ error: unknown; data: SharePreviewLink | null }>((resolve) => {
        releaseRotate = resolve
      })
      world.rotatePreviewLink = async (writingId) =>
        writingId === a ? heldRotate : { error: null, data: previewLink(LINK_B) }

      await clickEditorTab(a)
      await waitForHydrationReady("A activo antes de rotar el enlace")
      await openShareTab()
      await waitForShareLinkText(LINK_A)

      try {
        // Respuesta de A en vuelo.
        await clickShareAction("Regenerate")
        expect(world.sharingRotatePreviewLinkCalls, "la rotación de A salió al servicio").toEqual([a])

        // Cambio de pestaña con la respuesta de A todavía pendiente.
        await clickEditorTab(b)
        await waitForHydrationReady("B activo con el enlace de A en vuelo")
        await waitForShareLinkText(LINK_B)

        releaseRotate({ error: null, data: previewLink(LINK_A_ROTATED) })
        const toast = await waitForShareToast()
        expect(toast.textContent, "el toast nombra A aunque B esté seleccionado").toBe(
          `Share link for ‘${titleA}’ is ready`,
        )
        expect(toast.textContent).not.toContain(titleB)
      } finally {
        releaseRotate({ error: null, data: null })
      }

      // El enlace activo de B sigue siendo el de B, y su "Copy" copia el de B.
      expect(pageText(), "el enlace tardío de A no ocupa el panel de B").not.toContain(LINK_A_ROTATED)
      expect(pageText(), "el enlace de B sigue visible").toContain(LINK_B)
      await clickShareAction("Copy")
      expect(clipboardWrites.at(-1), "Copy copia el enlace de B").toBe(LINK_B)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "sin carrera: el enlace generado de A aparece y su toast sigue nombrando A al cambiar a B",
    async () => {
      const textA = "ODE652-SHARE-SEED-A"
      const textB = "ODE652-SHARE-SEED-B"
      const titleA = "ODE652 Share Seed A"
      const titleB = "ODE652 Share Seed B"
      const { a, b } = await openTwoAttributedDocuments(
        { text: textA, title: titleA },
        { text: textB, title: titleB },
      )

      world.getPreviewLink = async (writingId) => ({
        error: null,
        data: writingId === b ? previewLink(LINK_B) : null,
      })
      world.rotatePreviewLink = async () => ({ error: null, data: previewLink(LINK_A) })

      await clickEditorTab(a)
      await waitForHydrationReady("A activo antes de generar el enlace")
      await openShareTab()

      // Control positivo: sin cambio de pestaña, el resultado llega al panel.
      await clickShareAction("Generate link")
      const toast = await waitForShareToast()
      expect(toast.textContent, "el toast nombra A").toBe(`Share link for ‘${titleA}’ is ready`)
      await waitForShareLinkText(LINK_A)

      // Cambio a B: el aviso de A sigue siendo el de A y el enlace de A no
      // ocupa el panel de B, que tiene el suyo.
      await clickEditorTab(b)
      await waitForHydrationReady("B activo después de generar el enlace de A")
      await waitForShareLinkText(LINK_B)
      const retained = await waitForShareToast()
      expect(retained.textContent, "el aviso sigue atribuido a A").toBe(
        `Share link for ‘${titleA}’ is ready`,
      )
      expect(retained.textContent).not.toContain(titleB)
      expect(pageText(), "el enlace de A no ocupa el panel de B").not.toContain(LINK_A)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "carga retenida: el enlace de A no queda visible ni copiable bajo B mientras B carga",
    async () => {
      const textA = "ODE652-LOAD-RACE-A"
      const textB = "ODE652-LOAD-RACE-B"
      const titleA = "ODE652 Load Race A"
      const titleB = "ODE652 Load Race B"
      const { a, b } = await openTwoAttributedDocuments(
        { text: textA, title: titleA },
        { text: textB, title: titleB },
      )

      let releaseB: (value: { error: unknown; data: SharePreviewLink | null }) => void = () => {
        throw new Error("la carga de B no quedó retenida")
      }
      const heldB = new Promise<{ error: unknown; data: SharePreviewLink | null }>((resolve) => {
        releaseB = resolve
      })
      world.getPreviewLink = async (writingId) =>
        writingId === a ? { error: null, data: previewLink(LINK_A) } : heldB

      await clickEditorTab(a)
      await waitForHydrationReady("A activo antes de la carga retenida de B")
      await openShareTab()
      await waitForShareLinkText(LINK_A)

      await clickEditorTab(b)
      await waitForHydrationReady("B activo con su carga retenida")

      // Mientras B carga su enlace, nada de A es visible ni accionable bajo B.
      expect(pageText(), "el enlace de A no se muestra bajo B").not.toContain(LINK_A)
      expect(shareActionButton("Copy"), "no hay Copy del enlace de A bajo B").toBeNull()
      expect(pageText(), "B muestra que sigue cargando su enlace").toContain("Loading preview link…")

      releaseB({ error: null, data: previewLink(LINK_B) })
      await waitForShareLinkText(LINK_B)
      await clickShareAction("Copy")
      expect(clipboardWrites.at(-1), "Copy copia el enlace de B").toBe(LINK_B)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "carga retenida: la respuesta vieja de A no habilita las acciones de B mientras B carga",
    async () => {
      const textA = "ODE652-STALE-LOAD-A"
      const textB = "ODE652-STALE-LOAD-B"
      const titleA = "ODE652 Stale Load A"
      const titleB = "ODE652 Stale Load B"
      const { a, b } = await openTwoAttributedDocuments(
        { text: textA, title: titleA },
        { text: textB, title: titleB },
      )

      let releaseA: (value: { error: unknown; data: SharePreviewLink | null }) => void = () => {
        throw new Error("la carga de A no quedó retenida")
      }
      const heldA = new Promise<{ error: unknown; data: SharePreviewLink | null }>((resolve) => {
        releaseA = resolve
      })
      let releaseB: (value: { error: unknown; data: SharePreviewLink | null }) => void = () => {
        throw new Error("la carga de B no quedó retenida")
      }
      const heldB = new Promise<{ error: unknown; data: SharePreviewLink | null }>((resolve) => {
        releaseB = resolve
      })
      world.getPreviewLink = async (writingId) => (writingId === a ? heldA : heldB)

      await clickEditorTab(a)
      await waitForHydrationReady("A activo con su carga retenida")
      await openShareTab()
      await waitFor(() => shareActionButton("Generate link"), {
        label: "panel de compartir montado con la carga de A en vuelo",
      })

      await clickEditorTab(b)
      await waitForHydrationReady("B activo con ambas cargas retenidas")
      await waitFor(() => world.sharingGetPreviewLinkCalls.includes(b), {
        label: "la carga de B salió al servicio",
      })

      // La carga vieja de A termina mientras la de B sigue viva: no debe
      // habilitar ninguna acción de B ni mostrar nada de A.
      releaseA({ error: null, data: previewLink(LINK_A) })
      await flush(4)

      const generate = shareActionButton("Generate link")
      expect(generate, "B ofrece Generate mientras carga su enlace").not.toBeNull()
      expect(generate!.disabled, "la respuesta vieja de A no habilita Generate en B").toBe(true)
      expect(pageText(), "el enlace de A no se muestra bajo B").not.toContain(LINK_A)

      releaseB({ error: null, data: previewLink(LINK_B) })
      await waitForShareLinkText(LINK_B)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "regreso a A: una carga vieja de A no pisa la regeneración que ya terminó",
    async () => {
      const textA = "ODE652-RETURN-ROTATE-A"
      const textB = "ODE652-RETURN-ROTATE-B"
      const titleA = "ODE652 Return Rotate A"
      const titleB = "ODE652 Return Rotate B"
      const { a, b } = await openTwoAttributedDocuments(
        { text: textA, title: titleA },
        { text: textB, title: titleB },
      )

      let releaseB: (value: { error: unknown; data: SharePreviewLink | null }) => void = () => {
        throw new Error("la carga de B no quedó retenida")
      }
      const heldB = new Promise<{ error: unknown; data: SharePreviewLink | null }>((resolve) => {
        releaseB = resolve
      })
      let releaseStaleA: (value: { error: unknown; data: SharePreviewLink | null }) => void = () => {
        throw new Error("la recarga de A no quedó retenida")
      }
      const heldStaleA = new Promise<{ error: unknown; data: SharePreviewLink | null }>((resolve) => {
        releaseStaleA = resolve
      })
      let aCalls = 0
      world.getPreviewLink = async (writingId) => {
        if (writingId === b) return heldB
        aCalls += 1
        return aCalls === 1 ? { error: null, data: previewLink(LINK_A) } : heldStaleA
      }
      world.rotatePreviewLink = async () => ({ error: null, data: previewLink(LINK_A_ROTATED) })

      await clickEditorTab(a)
      await waitForHydrationReady("A activo con su enlace cacheado")
      await openShareTab()
      await waitForShareLinkText(LINK_A)

      // A→B y de vuelta a A con la recarga todavía en vuelo.
      await clickEditorTab(b)
      await waitForHydrationReady("B activo con su carga retenida")
      await clickEditorTab(a)
      await waitForHydrationReady("A activo de nuevo con su recarga retenida")
      await waitFor(() => aCalls >= 2, { label: "la recarga de A salió al servicio" })
      expect(pageText(), "control positivo: el enlace cacheado de A sigue visible").toContain(LINK_A)

      // La regeneración termina primero; la recarga vieja no debe pisarla.
      await clickShareAction("Regenerate")
      await waitForShareLinkText(LINK_A_ROTATED)
      releaseStaleA({ error: null, data: previewLink(LINK_A_STALE) })
      await flush(4)

      expect(pageText(), "la regeneración de A se conserva").toContain(LINK_A_ROTATED)
      expect(pageText(), "la carga vieja no pisa la regeneración").not.toContain(LINK_A_STALE)

      releaseB({ error: null, data: previewLink(LINK_B) })
      await flush(2)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "regreso a A: una carga vieja de A no revivía el enlace después de revocar",
    async () => {
      const textA = "ODE652-RETURN-REVOKE-A"
      const textB = "ODE652-RETURN-REVOKE-B"
      const titleA = "ODE652 Return Revoke A"
      const titleB = "ODE652 Return Revoke B"
      const { a, b } = await openTwoAttributedDocuments(
        { text: textA, title: titleA },
        { text: textB, title: titleB },
      )

      let releaseB: (value: { error: unknown; data: SharePreviewLink | null }) => void = () => {
        throw new Error("la carga de B no quedó retenida")
      }
      const heldB = new Promise<{ error: unknown; data: SharePreviewLink | null }>((resolve) => {
        releaseB = resolve
      })
      let releaseStaleA: (value: { error: unknown; data: SharePreviewLink | null }) => void = () => {
        throw new Error("la recarga de A no quedó retenida")
      }
      const heldStaleA = new Promise<{ error: unknown; data: SharePreviewLink | null }>((resolve) => {
        releaseStaleA = resolve
      })
      let aCalls = 0
      world.getPreviewLink = async (writingId) => {
        if (writingId === b) return heldB
        aCalls += 1
        return aCalls === 1 ? { error: null, data: previewLink(LINK_A) } : heldStaleA
      }
      world.revokePreviewLink = async (writingId) => ({
        error: null,
        data: { writingId, revoked: true },
      })

      await clickEditorTab(a)
      await waitForHydrationReady("A activo con su enlace cacheado")
      await openShareTab()
      await waitForShareLinkText(LINK_A)

      await clickEditorTab(b)
      await waitForHydrationReady("B activo con su carga retenida")
      await clickEditorTab(a)
      await waitForHydrationReady("A activo de nuevo con su recarga retenida")
      await waitFor(() => aCalls >= 2, { label: "la recarga de A salió al servicio" })
      expect(pageText(), "control positivo: el enlace cacheado de A sigue visible").toContain(LINK_A)

      const revoke = await waitFor(
        () =>
          findButton(
            mounted!.container,
            (button) => button.getAttribute("aria-label") === "Revoke preview link",
          ),
        { label: "botón de revocar el enlace" },
      )
      await act(async () => {
        revoke.click()
      })
      await flush(3)
      await waitFor(() => !pageText().includes(LINK_A), { label: "el enlace de A desaparece al revocar" })

      // La recarga vieja no puede revivir el enlace revocado.
      releaseStaleA({ error: null, data: previewLink(LINK_A_STALE) })
      await flush(4)
      expect(pageText(), "la carga vieja no revivía el enlace").not.toContain(LINK_A_STALE)
      expect(pageText(), "el enlace revocado sigue ausente").not.toContain(LINK_A)

      releaseB({ error: null, data: previewLink(LINK_B) })
      await flush(2)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "mutación en vuelo: una recarga iniciada después no pisa el resultado de la regeneración",
    async () => {
      const textA = "ODE652-MUTATION-ORDER-A"
      const textB = "ODE652-MUTATION-ORDER-B"
      const titleA = "ODE652 Mutation Order A"
      const titleB = "ODE652 Mutation Order B"
      const { a, b } = await openTwoAttributedDocuments(
        { text: textA, title: titleA },
        { text: textB, title: titleB },
      )

      let currentA = previewLink(LINK_A)
      let releaseRotate: (value: SharePreviewLink) => void = () => {
        throw new Error("la rotación no quedó retenida")
      }
      const heldRotate = new Promise<SharePreviewLink>((resolve) => {
        releaseRotate = resolve
      })
      let releaseReload: (value: { error: unknown; data: SharePreviewLink | null }) => void = () => {
        throw new Error("la recarga de A no quedó retenida")
      }
      const heldReload = new Promise<{ error: unknown; data: SharePreviewLink | null }>((resolve) => {
        releaseReload = resolve
      })
      let aCalls = 0
      world.getPreviewLink = async (writingId) => {
        if (writingId === b) return { error: null, data: previewLink(LINK_B) }
        aCalls += 1
        if (aCalls === 1) return { error: null, data: currentA }
        if (aCalls === 2) return heldReload
        return { error: null, data: currentA }
      }
      world.rotatePreviewLink = async () => {
        const rotated = await heldRotate
        currentA = rotated
        return { error: null, data: currentA }
      }

      await clickEditorTab(a)
      await waitForHydrationReady("A activo antes de la mutación")
      await openShareTab()
      await waitForShareLinkText(LINK_A)

      // Regeneración en vuelo y navegación A→B→A con la recarga retenida.
      await clickShareAction("Regenerate")
      await clickEditorTab(b)
      await waitForHydrationReady("B activo con la mutación en vuelo")
      await clickEditorTab(a)
      await waitForHydrationReady("A activo con la recarga post-navegación retenida")
      await waitFor(() => aCalls >= 2, { label: "la recarga de A salió al servicio" })

      // La mutación termina: debe revalidar el documento actual.
      releaseRotate(previewLink(LINK_A_ROTATED))
      await waitForShareLinkText(LINK_A_ROTATED)

      // La recarga vieja (pre-mutación) no puede pisar la revalidación.
      releaseReload({ error: null, data: previewLink(LINK_A_STALE) })
      await flush(4)
      expect(pageText(), "la revalidación se conserva").toContain(LINK_A_ROTATED)
      expect(pageText(), "la recarga vieja no pisa la mutación").not.toContain(LINK_A_STALE)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "cambio a un borrador sin id: el indicador de carga de A no queda visible en el nuevo documento",
    async () => {
      const textA = "ODE652-LOCAL-SWITCH-A"
      const a = await createAndOpenDocument(textA)
      await confirmInCloud(a, textA)

      let releaseA: (value: { error: unknown; data: SharePreviewLink | null }) => void = () => {
        throw new Error("la carga de A no quedó retenida")
      }
      const heldA = new Promise<{ error: unknown; data: SharePreviewLink | null }>((resolve) => {
        releaseA = resolve
      })
      world.getPreviewLink = async (writingId) =>
        writingId === a ? heldA : { error: null, data: null }

      // Borrador en blanco (sin id) en la misma montura: su early return no
      // puede disparar ninguna carga contra el servicio.
      await clickNewArtifact(mounted!.container)
      await flush(3)
      const blankTab = getEditorSessionState().session.tabs.find((tab) => !tab.writing_id)
      if (!blankTab) throw new Error("No hay pestaña de borrador sin id")

      await clickEditorTab(a)
      await waitForHydrationReady("A remoto activo")
      await openShareTab()
      await waitFor(() => pageText().includes("Loading preview link…"), {
        label: "A muestra que está cargando su enlace",
      })

      const blankNode = document.querySelector<HTMLElement>(`[data-editor-tab-id="${blankTab.id}"]`)
      if (!blankNode) throw new Error("La pestaña del borrador no está en el DOM")
      await pointerClick(blankNode)
      await flush(3)
      expect(getEditorSessionState().session.active_tab_id, "el borrador quedó activo").toBe(blankTab.id)
      expect(pageText(), "el borrador no hereda el indicador de carga de A").not.toContain(
        "Loading preview link…",
      )

      releaseA({ error: null, data: previewLink(LINK_A) })
      await flush(3)

      // La pestaña efímera no debe quedar viva al desmontar: vuelve a A y
      // cierra el borrador.
      await clickEditorTab(a)
      const blankAfter = document.querySelector<HTMLElement>(`[data-editor-tab-id="${blankTab.id}"]`)
      const close = blankAfter?.querySelector<HTMLElement>('[aria-label^="Close "]')
      if (close) {
        await pointerClick(close)
      }
      await flush(3)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it.fails(
    "cerrar y reabrir el panel durante una regeneración no pierde la mutación",
    async () => {
      const textA = "ODE652-CLOSE-REOPEN-ROTATE"
      const a = await createAndOpenDocument(textA)
      await confirmInCloud(a, textA)

      world.getPreviewLink = async () => ({ error: null, data: previewLink(LINK_A) })
      let releaseRotate: (value: { error: unknown; data: SharePreviewLink | null }) => void = () => {
        throw new Error("la rotación no quedó retenida")
      }
      const heldRotate = new Promise<{ error: unknown; data: SharePreviewLink | null }>((resolve) => {
        releaseRotate = resolve
      })
      world.rotatePreviewLink = async () => heldRotate

      await clickEditorTab(a)
      await waitForHydrationReady("A activo antes de la regeneración")
      await openShareTab()
      await waitForShareLinkText(LINK_A)

      await clickShareAction("Regenerate")

      const close = await waitFor(
        () =>
          findButton(
            mounted!.container,
            (button) => button.getAttribute("aria-label") === "Close panel",
          ),
        { label: 'botón "Close panel"' },
      )
      await act(async () => {
        close.click()
      })
      await flush(3)
      expect(
        document.querySelector('[data-testid="editor-right-panel-tabs"]'),
        "el panel quedó cerrado con la mutación en vuelo",
      ).toBeNull()

      // Reabrir: la misma instancia sigue esperando la mutación.
      await openShareTab()
      const regenerate = shareActionButton("Regenerate")
      expect(regenerate, "el panel reabrió con la regeneración en curso").not.toBeNull()
      expect(regenerate!.disabled, "la instancia sobrevivió al cierre: sigue guardando").toBe(true)

      releaseRotate({ error: null, data: previewLink(LINK_A_ROTATED) })
      await waitForShareLinkText(LINK_A_ROTATED)
      expect(pageText(), "el enlace regenerado quedó visible").toContain(LINK_A_ROTATED)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it.fails(
    "cerrar y reabrir el panel durante una revocación no revive el enlace",
    async () => {
      const textA = "ODE652-CLOSE-REOPEN-REVOKE"
      const a = await createAndOpenDocument(textA)
      await confirmInCloud(a, textA)

      world.getPreviewLink = async () => ({ error: null, data: previewLink(LINK_A) })
      let releaseRevoke: (value: { error: unknown; data: { writingId: string; revoked: boolean } | null }) => void =
        () => {
          throw new Error("la revocación no quedó retenida")
        }
      const heldRevoke = new Promise<{
        error: unknown
        data: { writingId: string; revoked: boolean } | null
      }>((resolve) => {
        releaseRevoke = resolve
      })
      world.revokePreviewLink = async () => heldRevoke

      await clickEditorTab(a)
      await waitForHydrationReady("A activo antes de revocar")
      await openShareTab()
      await waitForShareLinkText(LINK_A)

      const revoke = await waitFor(
        () =>
          findButton(
            mounted!.container,
            (button) => button.getAttribute("aria-label") === "Revoke preview link",
          ),
        { label: "botón de revocar el enlace" },
      )
      await act(async () => {
        revoke.click()
      })
      await flush(3)

      const close = await waitFor(
        () =>
          findButton(
            mounted!.container,
            (button) => button.getAttribute("aria-label") === "Close panel",
          ),
        { label: 'botón "Close panel"' },
      )
      await act(async () => {
        close.click()
      })
      await flush(3)
      expect(
        document.querySelector('[data-testid="editor-right-panel-tabs"]'),
        "el panel quedó cerrado con la revocación en vuelo",
      ).toBeNull()

      await openShareTab()
      const revokeAfter = await waitFor(
        () =>
          findButton(
            mounted!.container,
            (button) => button.getAttribute("aria-label") === "Revoke preview link",
          ),
        { label: "el panel reabrió con la revocación en curso" },
      )
      expect(revokeAfter.disabled, "la instancia sobrevivió al cierre: sigue guardando").toBe(true)

      releaseRevoke({ error: null, data: { writingId: a, revoked: true } })
      await waitFor(() => !pageText().includes(LINK_A), {
        label: "el enlace desaparece al completar la revocación",
      })
      expect(pageText(), "el enlace revocado no revive").not.toContain(LINK_A)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "regreso a A: una recarga vieja que falla no borra la regeneración",
    async () => {
      const textA = "ODE652-STALE-LOAD-ERROR-A"
      const textB = "ODE652-STALE-LOAD-ERROR-B"
      const titleA = "ODE652 Stale Load Error A"
      const titleB = "ODE652 Stale Load Error B"
      const { a, b } = await openTwoAttributedDocuments(
        { text: textA, title: titleA },
        { text: textB, title: titleB },
      )

      let currentA = previewLink(LINK_A)
      let releaseRotate: (value: SharePreviewLink) => void = () => {
        throw new Error("la rotación no quedó retenida")
      }
      const heldRotate = new Promise<SharePreviewLink>((resolve) => {
        releaseRotate = resolve
      })
      let releaseReload: (value: { error: unknown; data: SharePreviewLink | null }) => void = () => {
        throw new Error("la recarga de A no quedó retenida")
      }
      const heldReload = new Promise<{ error: unknown; data: SharePreviewLink | null }>((resolve) => {
        releaseReload = resolve
      })
      let aCalls = 0
      world.getPreviewLink = async (writingId) => {
        if (writingId === b) return { error: null, data: previewLink(LINK_B) }
        aCalls += 1
        if (aCalls === 1) return { error: null, data: currentA }
        if (aCalls === 2) return heldReload
        return { error: null, data: currentA }
      }
      world.rotatePreviewLink = async () => {
        const rotated = await heldRotate
        currentA = rotated
        return { error: null, data: currentA }
      }

      await clickEditorTab(a)
      await waitForHydrationReady("A activo antes de la mutación")
      await openShareTab()
      await waitForShareLinkText(LINK_A)

      await clickShareAction("Regenerate")
      await clickEditorTab(b)
      await waitForHydrationReady("B activo con la mutación en vuelo")
      await clickEditorTab(a)
      await waitForHydrationReady("A activo con su recarga post-navegación retenida")
      await waitFor(() => aCalls >= 2, { label: "la recarga de A salió al servicio" })

      releaseRotate(previewLink(LINK_A_ROTATED))
      await waitForShareLinkText(LINK_A_ROTATED)

      // La recarga vieja falla después: su error no puede borrar la mutación.
      releaseReload({
        error: { code: "DB_ERROR", message: "load failed", retryable: true },
        data: null,
      })
      await flush(4)
      expect(pageText(), "la regeneración se conserva tras el fallo viejo").toContain(LINK_A_ROTATED)
      expect(pageText(), "el error de la carga vieja no aparece").not.toContain("load failed")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

describe("EXP-05 — callers reales de Desk y Collections (ODE-636)", () => {
  it(
    "Desk preview: el Markdown que reporta éxito llega al fs por el diálogo de desktop",
    async () => {
      const text = "ODE636-DESK-MARKDOWN-BODY"
      const writingId = await createAndOpenDocument(text)
      const successDir = freshDir("desk-page-markdown-success")
      const target = join(successDir, "desk-letter.md")
      const dialogCallsBefore = world.saveDialogCalls.length
      world.saveDialogResult = target

      await openProductionPreview("desk", writingId)
      await clickPreviewExport("markdown")

      await waitFor(() => world.saveDialogCalls.length === dialogCallsBefore + 1, {
        label: "diálogo de export de Desk invocado",
      })
      await waitFor(() => pageText().includes("Markdown exported."), {
        label: "éxito del export Markdown de Desk",
      })
      expect(world.saveDialogCalls).toHaveLength(dialogCallsBefore + 1)
      expect(await listExports(successDir)).toEqual(["desk-letter.md"])
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "Collections preview: el Markdown que reporta éxito llega al fs por el diálogo de desktop",
    async () => {
      const text = "ODE636-COLLECTIONS-MARKDOWN-BODY"
      const writingId = await createAndOpenDocument(text)
      const successDir = freshDir("collections-page-markdown-success")
      const target = join(successDir, "collection-letter.md")
      const dialogCallsBefore = world.saveDialogCalls.length
      world.saveDialogResult = target

      await openProductionPreview("collections", writingId)
      await clickPreviewExport("markdown")

      await waitFor(() => world.saveDialogCalls.length === dialogCallsBefore + 1, {
        label: "diálogo de export de Collections invocado",
      })
      await waitFor(() => pageText().includes("Markdown exported."), {
        label: "éxito del export Markdown de Collections",
      })
      expect(world.saveDialogCalls).toHaveLength(dialogCallsBefore + 1)
      expect(await listExports(successDir)).toEqual(["collection-letter.md"])
      expect((await readFile(target)).toString("utf8")).toContain(text)
    },
    TEST_TIMEOUT_MS,
  )
})

describe("Desk desktop Markdown body (ODE-636)", () => {
  it(
    "exports the body from the materialized document",
    async () => {
      const text = "ODE636-DESK-MARKDOWN-BODY"
      const writingId = await createAndOpenDocument(text)
      const successDir = freshDir("desk-materialized-body")
      const target = join(successDir, "desk-body.md")
      const dialogCallsBefore = world.saveDialogCalls.length
      world.saveDialogResult = target

      await openProductionPreview("desk", writingId)
      await clickPreviewExport("markdown")

      await waitFor(() => world.saveDialogCalls.length === dialogCallsBefore + 1, {
        label: "diálogo de export de Desk invocado para el cuerpo materializado",
      })
      await waitFor(() => pageText().includes("Markdown exported."), {
        label: "éxito del export de Desk con cuerpo materializado",
      })
      expect((await readFile(target)).toString("utf8")).toContain(text)
    },
    TEST_TIMEOUT_MS,
  )
})

describe("EXP-05 — cancelación y fallo de escritura en preview Markdown (ODE-636)", () => {
  for (const surface of ["desk", "collections"] as const) {
    it(
      `${surface}: cancela en silencio y muestra el error de escritura`,
      async () => {
        const text = `ODE636-${surface.toUpperCase()}-PREVIEW-MARKDOWN-BODY`
        const writingId = await createAndOpenDocument(text)
        await openProductionPreview(surface, writingId)
        await assertProductionPreviewMarkdownChain(surface, text)
      },
      TEST_TIMEOUT_MS,
    )
  }
})

describe("EXP-05 — export real desde el preview de Desk (ODE-636)", () => {
  for (const format of ["pdf", "docx"] as const) {
    it(
      `${format}: éxito escribe el artefacto; cancelar y fallo no muestran éxito`,
      async () => {
        const text = `ODE636-DESK-${format.toUpperCase()}-BODY`
        const writingId = await createAndOpenDocument(text)
        await confirmInCloud(writingId, text)
        await openProductionPreview("desk", writingId)

        await assertProductionPreviewExportChain(
          format,
          `desk-letter.${format}`,
          (bytes) => {
            if (format === "pdf") {
              expect(bytes.subarray(0, 5).toString("latin1"), "cabecera PDF").toBe("%PDF-")
              return
            }
            expect([...bytes.subarray(0, 4)], "firma zip del .docx").toEqual([0x50, 0x4b, 0x03, 0x04])
          },
        )
      },
      TEST_TIMEOUT_MS,
    )
  }
})

describe("EXP-05 — aviso de export Markdown desde los menús de fila (ODE-636)", () => {
  for (const surface of ["desk", "collections"] as const) {
    it(
      `${surface}: el menú confirma, cancela en silencio y muestra el fallo de escritura`,
      async () => {
        const text = `ODE636-${surface.toUpperCase()}-ROW-MARKDOWN-BODY`
        const writingId = await createAndOpenDocument(text)
        const record = await getCatalogRecord(writingId)
        if (!record.title) throw new Error(`Expected a title for ${writingId}`)
        const title = record.title
        await mountProductionSurface(surface)
        const liveRegion = document.querySelector<HTMLElement>(
          '[data-testid="markdown-export-live-region"]',
        )
        expect(liveRegion).not.toBeNull()
        expect(liveRegion?.textContent).toBe("")

        const unselectedSuccessDir = freshDir(`${surface}-row-markdown-unselected-success`)
        const unselectedTarget = join(unselectedSuccessDir, `${surface}-unselected.md`)
        world.saveDialogResult = unselectedTarget
        const unselectedDialogCount = world.saveDialogCalls.length
        await clickProductionRowDownload(title)
        await waitForSaveDialogCall(unselectedDialogCount, `${surface} export without selection`)
        const unselectedNotice = await waitForExportNotice("success")
        expect(unselectedNotice.getAttribute("data-placement")).toBe(surface === "desk" ? "absolute" : "fixed")
        expect(document.querySelector('[data-selection-bar="true"]')).toBeNull()
        expect((await readFile(unselectedTarget)).toString("utf8")).toContain(text)
        await advance(3100)
        expect(document.querySelector('[data-testid="markdown-export-notice"]')).toBeNull()

        await selectProductionRow(title)

        const successDir = freshDir(`${surface}-row-markdown-success`)
        const target = join(successDir, `${surface}-row.md`)
        world.saveDialogResult = target
        const successDialogCount = world.saveDialogCalls.length
        await clickProductionRowDownload(title)
        await waitForSaveDialogCall(successDialogCount, `${surface} abrió el diálogo de export`)

        const successNotice = await waitForExportNotice("success")
        expect(successNotice.textContent?.trim()).toBe("Markdown exported")
        expect(document.querySelector('[data-testid="markdown-export-live-region"]')).toBe(liveRegion)
        expect(liveRegion?.getAttribute("role")).toBe("status")
        expect(liveRegion?.getAttribute("aria-live")).toBe("polite")
        expect(successNotice.className).toContain("bottom-[96px]")
        expect(successNotice.getAttribute("data-placement")).toBe(surface === "desk" ? "absolute" : "fixed")
        expect(document.querySelector('[data-selection-bar="true"]')).not.toBeNull()
        expect((await readFile(target)).toString("utf8")).toContain(text)

        await advance(3100)
        expect(document.querySelector('[data-testid="markdown-export-notice"]')).toBeNull()
        expect(liveRegion?.textContent).toBe("")

        world.saveDialogResult = null
        const cancelDialogCount = world.saveDialogCalls.length
        await clickProductionRowDownload(title)
        await waitForSaveDialogCall(cancelDialogCount, `${surface} abrió el diálogo cancelado`)
        await flush(2)
        expect(document.querySelector('[data-testid="markdown-export-notice"]')).toBeNull()
        expect(pageText()).not.toContain("Markdown exported")
        expect(pageText()).not.toContain("Failed to export Markdown.")

        const failureDir = freshDir(`${surface}-row-markdown-failure`)
        const blocker = join(failureDir, "not-a-directory")
        await writeFile(blocker, "occupied")
        world.saveDialogResult = join(blocker, `${surface}-row.md`)
        const failureDialogCount = world.saveDialogCalls.length
        await clickProductionRowDownload(title)
        await waitForSaveDialogCall(failureDialogCount, `${surface} abrió el diálogo que falla al escribir`)

        const failureNotice = await waitForExportNotice("error")
        expect(failureNotice.textContent?.trim()).toBe("Failed to export Markdown.")
        expect(document.querySelector('[data-testid="markdown-export-live-region"]')).toBe(liveRegion)
        expect(liveRegion?.getAttribute("role")).toBe("status")
        expect(liveRegion?.getAttribute("aria-live")).toBe("polite")
        expect(pageText()).not.toContain("Markdown exported")
        assertNoUnhandledErrors()
      },
      TEST_TIMEOUT_MS,
    )
  }
})

describe("Desk row Markdown copy errors (ODE-636)", () => {
  it(
    "handles a rejected materialized-file read from the fire-and-forget row action",
    async () => {
      const text = "ODE636-DESK-COPY-MISSING-FILE"
      const writingId = await createAndOpenDocument(text)
      const record = await getCatalogRecord(writingId)
      const canonicalPath = record.binding?.canonicalPath
      if (!canonicalPath) throw new Error(`Expected a canonical path for ${writingId}`)
      if (!record.title) throw new Error(`Expected a title for ${writingId}`)

      await mountProductionSurface("desk")
      unlinkSync(canonicalPath)
      await clickProductionRowMenuItem(record.title, "Copy markdown")
      await flush(3)

      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

describe("Collections preview Markdown read errors (ODE-636)", () => {
  it(
    "uses the fixed export error copy when the materialized source cannot be read",
    async () => {
      const text = "ODE636-COLLECTIONS-MARKDOWN-MISSING-FILE"
      const writingId = await createAndOpenDocument(text)
      const record = await getCatalogRecord(writingId)
      const canonicalPath = record.binding?.canonicalPath
      if (!canonicalPath) throw new Error(`Expected a canonical path for ${writingId}`)

      await openProductionPreview("collections", writingId)
      unlinkSync(canonicalPath)
      const readResult = await (await getDocumentService()).openWriting(writingId)
      const rawReadError = readResult.error?.message
      if (!rawReadError) throw new Error("Expected the materialized-file read to fail")
      await clickPreviewExport("markdown")

      await waitFor(() => pageText().includes("Failed to export Markdown."), {
        label: "fixed Collections Markdown source-read error",
      })
      expect(pageText()).not.toContain(rawReadError)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})
