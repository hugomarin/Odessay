/**
 * @vitest-environment happy-dom
 *
 * ODE-684 — R01/R03 web proof. This drives the production EditorShell, real
 * status-bar mode buttons, real Markdown textarea, TipTap, and localDB backed
 * by fake-indexeddb. Web has no filesystem write to retain, so the durable
 * completion event is the updated local writing row.
 */
import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

const { act } = await import("react")
const {
  advance,
  clickNewArtifact,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  selectEditorText,
  typeInEditor,
  waitFor,
  waitForHydrationReady,
} = await import("./support/editor-shell-harness")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { createEmptyEditorSession, EDITOR_DRAFT_TAB_ID } = await import("@/lib/local-db/editor-sessions")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { localDB } = await import("@/lib/local-db")

const TEST_TIMEOUT_MS = 60_000
const SOURCE_DEBOUNCE_MS = 1_000
const MASTER_SOURCE = readFileSync("tests/fixtures/document-components/valid/master.md", "utf8")
const MASTER_SEED = "DOC_COMPONENT_MASTER_SEED"
type JsonNode = { type?: string; attrs?: Record<string, unknown>; content?: JsonNode[] }

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeEach(async () => {
  resetEditorShellWorld()
  await writeEditorSession(createEmptyEditorSession())
})

afterEach(async () => {
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
})

function activeWritingId() {
  const { session } = getEditorSessionState()
  const writingId = session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id
  return writingId && writingId !== EDITOR_DRAFT_TAB_ID ? writingId : null
}

async function switchMode(label: "Rich" | "Markdown") {
  const button = await waitFor(
    () =>
      Array.from(
        mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
      ).find((candidate) => (candidate.textContent ?? "").trim() === label),
    { label: `botón "${label}" de la status bar` },
  )
  await act(async () => {
    button.click()
  })
  await flush(2)
  await waitFor(
    () =>
      label === "Markdown"
        ? markdownSource()
        : !markdownSource() && mounted!.prosemirror(),
    { label: `editor en modo ${label}` },
  )
}

function markdownSource() {
  return mounted!.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]')
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

async function waitForLocalWriting(
  writingId: string,
  predicate: (row: Awaited<ReturnType<typeof localDB.writings.get>>) => boolean,
  label: string,
) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const row = await localDB.writings.get(writingId)
    if (predicate(row)) return row
    await advance(100)
  }
  throw new Error(`No llegó el evento durable de ${label} para ${writingId}`)
}

async function placeCaretAfter(needle: string) {
  const target = await selectEditorText(needle)
  await act(async () => {
    mounted!.editor().commands.focus()
    mounted!.editor().commands.setTextSelection(target.to)
  })
  await flush(1)
}

function richNodesOfType(type: string) {
  const found: JsonNode[] = []
  const visit = (node: JsonNode) => {
    if (node.type === type) found.push(node)
    for (const child of node.content ?? []) visit(child)
  }
  visit(mounted!.editor().getJSON() as JsonNode)
  return found
}

function opaqueSourceNodes(bodyJson: unknown) {
  const found: string[] = []
  const visit = (node: JsonNode) => {
    if (node.type === "opaqueSource" || node.type === "opaqueSourceBlock") {
      if (typeof node.attrs?.raw === "string") found.push(node.attrs.raw)
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(bodyJson as JsonNode)
  return found
}

async function createMasterDocument() {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
  await clickNewArtifact(mounted.container)
  await typeInEditor(MASTER_SEED)
  await advance(SOURCE_DEBOUNCE_MS)
  const writingId = await waitFor(activeWritingId, {
    label: "pestaña activa materializada con identidad",
    timeoutMs: 15_000,
  })
  await waitForLocalWriting(writingId, (row) => Boolean(row?.body_text?.includes(MASTER_SEED)), "la primera escritura")

  await switchMode("Markdown")
  await replaceMarkdownSource(MASTER_SOURCE)
  await switchMode("Rich")
  const canonicalRow = await waitForLocalWriting(
    writingId,
    (row) => Boolean(row?.body_text?.includes("TAIL_MASTER remains editable")),
    "la canonicalización del maestro en IndexedDB",
  )
  return { writingId, canonicalRow }
}

describe("ODE-684 — componentes documentales en la shell web", () => {
  it(
    "round-trip del maestro es idempotente y el segundo toggle limpio no persiste",
    async () => {
      const { writingId, canonicalRow } = await createMasterDocument()

      expect(richNodesOfType("card").map((node) => node.attrs)).toEqual([
        expect.objectContaining({
          title: "Card maestro",
          icon: "star",
          href: "https://example.com/master?a=1&b=2",
        }),
      ])
      expect(richNodesOfType("tip").map((node) => node.attrs)).toEqual([
        expect.objectContaining({ title: "Tip maestro" }),
      ])
      expect(richNodesOfType("info").map((node) => node.attrs)).toEqual([
        expect.objectContaining({ title: "Info maestra" }),
      ])
      expect(mounted!.editor().getText()).toContain("CARD_BODY_MASTER")
      expect(mounted!.editor().getText()).toContain("TIP_BODY_MASTER")
      expect(mounted!.editor().getText()).toContain("INFO_BODY_MASTER")
      const opaque = opaqueSourceNodes(canonicalRow?.body_json)
      expect(opaque.some((raw) => raw.includes("OPAQUE_PROTECTED_MASTER"))).toBe(true)
      expect(opaque.some((raw) => raw.includes("OPAQUE_FUTURE_MASTER"))).toBe(true)
      expect(opaque.some((raw) => raw.includes("OPAQUE_INVALID_ATTRS_MASTER"))).toBe(true)
      expect(opaque.some((raw) => raw.includes("<Widget mode=\"future\" />"))).toBe(true)

      await switchMode("Markdown")
      const firstCanonicalSource = markdownSource()?.value
      expect(firstCanonicalSource).toContain("LITERAL_FENCE_MASTER")
      expect(firstCanonicalSource).toContain("OPAQUE_FUTURE_MASTER")
      await switchMode("Rich")
      await waitForLocalWriting(writingId, (row) => row?.body_text === canonicalRow?.body_text, "primer ciclo")

      // Una shell nueva hidratea del IndexedDB real del runtime web.
      await mounted!.unmount()
      await writeEditorSession(createEmptyEditorSession())
      resetEditorShellWorld()
      mounted = await mountEditorShell({ writingId })
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión vacía cargada" })
      await waitFor(() => mounted!.editor().getText().includes("CARD_BODY_MASTER"), {
        label: "reapertura desde la fila local",
        timeoutMs: 15_000,
      })
      await waitForHydrationReady()

      const updateSpy = vi.spyOn(localDB.writings, "update")
      const updatesBefore = updateSpy.mock.calls.length
      const beforeCleanCycle = await localDB.writings.get(writingId)
      await switchMode("Markdown")
      expect(markdownSource()?.value).toBe(firstCanonicalSource)
      await switchMode("Rich")
      await switchMode("Markdown")
      expect(markdownSource()?.value, "el segundo ciclo conserva exactamente el source canonicalizado").toBe(
        firstCanonicalSource,
      )
      await switchMode("Rich")
      await advance(SOURCE_DEBOUNCE_MS)
      const afterCleanCycle = await localDB.writings.get(writingId)
      expect(updateSpy.mock.calls.length, "control negativo: el toggle limpio no persiste").toBe(updatesBefore)
      expect(afterCleanCycle?.body_json).toEqual(beforeCleanCycle?.body_json)
      expect(afterCleanCycle?.body_text).toBe(beforeCleanCycle?.body_text)
      expect(afterCleanCycle?.version).toBe(beforeCleanCycle?.version)

      // Control positivo: una edición real cruza la misma ruta y actualiza la fila.
      await placeCaretAfter(MASTER_SEED)
      await typeInEditor(" WEB_R02_CONTROL")
      await advance(1_500)
      const edited = await waitForLocalWriting(
        writingId,
        (row) => Boolean(row?.body_text?.includes("WEB_R02_CONTROL")),
        "el control positivo de persistencia",
      )
      expect(updateSpy).toHaveBeenCalled()
      expect(edited?.body_json).not.toEqual(beforeCleanCycle?.body_json)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "Source actualizado antes del debounce y edición Rich final llegan a la fila local",
    async () => {
      const { writingId } = await createMasterDocument()
      const sourceEdited = MASTER_SOURCE
        .replace('title="Card maestro"', 'title="Card web Source"')
        .replace('icon="star"', 'icon="heart"')
        .replace("CARD_BODY_MASTER", "CARD_WEB_SOURCE_EDIT")
      await switchMode("Markdown")
      await replaceMarkdownSource(sourceEdited)
      await switchMode("Rich")
      expect(richNodesOfType("card").map((node) => node.attrs)).toEqual([
        expect.objectContaining({ title: "Card web Source", icon: "heart" }),
      ])
      expect(mounted!.editor().getText()).toContain("CARD_WEB_SOURCE_EDIT")

      await placeCaretAfter("CARD_WEB_SOURCE_EDIT")
      await typeInEditor(" WEB_R03_FINAL")
      await advance(SOURCE_DEBOUNCE_MS)
      const finalRow = await waitForLocalWriting(
        writingId,
        (row) => Boolean(row?.body_text?.includes("WEB_R03_FINAL")),
        "la edición final después de Source",
      )
      await advance(SOURCE_DEBOUNCE_MS)
      const stableRow = await localDB.writings.get(writingId)
      expect(stableRow?.body_text).toContain("WEB_R03_FINAL")
      const serialized = JSON.stringify(stableRow?.body_json)
      expect(serialized).toContain("CARD_WEB_SOURCE_EDIT")
      expect(serialized).toContain("WEB_R03_FINAL")
      expect(serialized).toContain('"title":"Card web Source"')
      expect(serialized).toContain('"icon":"heart"')
      expect(finalRow?.body_text).toContain("CARD_WEB_SOURCE_EDIT")
    },
    TEST_TIMEOUT_MS,
  )
})
