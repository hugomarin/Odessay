/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-602 (corte 4a, entrega 1) — red de find/replace A TRAVÉS de la
 * shell, antes de mudar su cableado a un hook. Las piezas puras
 * (`lib/editor/find-replace.ts`) ya tienen `tests/editor-find-replace.test.ts`;
 * lo que no tenía prueba es el cableado: el atajo, el panel, las decoraciones
 * en el editor real y que el reemplazo llegue a la persistencia.
 *
 *   1. Buscar resalta las coincidencias en el editor real.
 *   2. "Replace" y "Replace all" cambian el documento, lo marcan como sucio y
 *      el cambio llega a lo guardado (se lee `localDB`, no el DOM).
 *   3. Al cambiar de documento, la búsqueda no se aplica sobre el nuevo con los
 *      resultados del anterior.
 *
 * La red encontró un bug real (ODE-630): en rich mode las coincidencias con
 * las que actúan Replace/Replace all no se recalculan tras editar ni tras
 * cambiar de documento. Sus dos casos quedan como `it.fails`.
 *
 * Camino de producción (web): A y B abiertos como pestañas; atajo real ⌘F /
 * Ctrl+F sobre `window`; los campos y botones reales del panel. Persistencia
 * real (`PersistenceCoordinator` → `localDB` sobre fake-indexeddb). Dobles:
 * solo la red y el proveedor de AI (harness).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"

import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("next/navigation", async () =>
  (await import("./support/editor-shell-doubles")).nextNavigationDouble(),
)
vi.mock("@tauri-apps/api/core", async (importOriginal) =>
  (await import("./support/editor-shell-doubles")).tauriCoreDouble(
    await importOriginal<Record<string, unknown>>(),
  ),
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

const {
  advance,
  assertNoUnhandledErrors,
  clickEditorTab,
  fillTextField,
  flush,
  mountEditorShell,
  pressEditorShortcut,
  pressEscape,
  resetEditorShellWorld,
  waitFor,
} = await import("./support/editor-shell-harness")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { createEditorSessionTab, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 30_000
const TEXT_A = "Uno gato dos gato tres gato."
const TEXT_B = "Documento B sin la palabra buscada, solo relleno largo."

let writingA = ""
let writingB = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

function makeLocalWriting(id: string, bodyText: string, title: string): LocalWriting {
  return {
    id,
    title,
    body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }] },
    body_text: bodyText,
    status: "draft",
    visibility: "private",
    version: 1,
    sync_status: "synced",
    lifecycle: "server-confirmed",
    created_at: "2026-09-20T00:00:00.000Z",
    updated_at: "2026-09-20T00:00:00.000Z",
    local_updated_at: Date.now(),
  } as LocalWriting
}

beforeEach(async () => {
  // Ids nuevos por test: fake-indexeddb persiste entre tests del archivo.
  writingA = crypto.randomUUID()
  writingB = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingA, TEXT_A, "Documento A"))
  await localDB.writings.save(makeLocalWriting(writingB, TEXT_B, "Documento B"))
  await writeEditorSession({
    ...createEmptyEditorSession(),
    active_tab_id: writingA,
    tabs: [
      createEditorSessionTab({ id: writingA, writingId: writingA, title: "Documento A" }),
      createEditorSessionTab({ id: writingB, writingId: writingB, title: "Documento B" }),
    ],
  })
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

async function openA() {
  mounted = await mountEditorShell({ writingId: writingA })
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await waitFor(() => mounted!.editor().getText().includes(TEXT_A), { label: "A hidratado", timeoutMs: 10_000 })
  await waitFor(() => document.querySelector(`[data-editor-tab-id="${writingB}"]`), { label: "pestaña de B" })
}

/** Abre el panel con el atajo real y devuelve su campo de búsqueda. */
async function openFindPanel() {
  await pressEditorShortcut({ key: "f", code: "KeyF" })
  return waitFor(() => document.querySelector<HTMLInputElement>('input[aria-label="Find text"]'), {
    label: "panel de find/replace abierto",
  })
}

function replaceInput() {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Replace text"]')
  if (!input) throw new Error("El panel no tiene el campo de reemplazo")
  return input
}

async function pressPanelButton(label: "Replace" | "Replace all") {
  const panel = document.querySelector('section[aria-label="Find and replace"]')
  const button = Array.from(panel?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (candidate) => (candidate.textContent ?? "").trim() === label,
  )
  if (!button) throw new Error(`El panel no tiene el botón "${label}"`)
  if (button.disabled) throw new Error(`El botón "${label}" está deshabilitado`)
  await act(async () => {
    button.click()
  })
  await flush(2)
}

/** Las coincidencias que el editor real está pintando. */
function highlightedMatches() {
  return Array.from(mounted!.prosemirror()?.querySelectorAll<HTMLElement>(".od-find-match") ?? []).map(
    (node) => node.textContent,
  )
}

function statusLabel() {
  const panel = document.querySelector('section[aria-label="Find and replace"]')
  return panel?.textContent ?? ""
}

/**
 * Registra cada etiqueta de guardado que pinta el status bar. "Marcado como
 * sucio" se observa como el paso de "Saved" a "Saving..." después de la
 * acción. (En el harness no llega a "Saved" otra vez: la red está doblada y
 * la subida a la nube no confirma; lo guardado se lee en `localDB`.)
 */
function recordSaveLabels() {
  const bar = document.querySelector<HTMLElement>('[data-testid="editor-statusbar"]')
  if (!bar) throw new Error("La shell no tiene status bar")
  const labels: string[] = []
  const read = () => bar.querySelector("p")?.textContent ?? ""
  const observer = new MutationObserver(() => {
    const label = read()
    if (labels[labels.length - 1] !== label) labels.push(label)
  })
  observer.observe(bar, { subtree: true, childList: true, characterData: true })
  return { labels, stop: () => observer.disconnect() }
}

async function waitForSavedBody(writingId: string, predicate: (body: string) => boolean, label: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const body = (await localDB.writings.get(writingId))?.body_text ?? ""
    if (predicate(body)) return body
    await advance(100)
  }
  const body = (await localDB.writings.get(writingId))?.body_text ?? ""
  throw new Error(`Lo guardado de ${writingId} nunca cumplió: ${label} (body: ${JSON.stringify(body)})`)
}

describe("ODE-602 — find/replace a través de la shell", () => {
  it(
    "buscar resalta en el editor real cada coincidencia y la activa",
    async () => {
      await openA()
      const find = await openFindPanel()
      await fillTextField(find, "gato")

      await waitFor(() => highlightedMatches().length === 3, { label: "tres coincidencias pintadas" })
      expect(highlightedMatches()).toEqual(["gato", "gato", "gato"])
      expect(mounted!.prosemirror()?.querySelectorAll(".od-find-match-active").length, "una sola activa").toBe(1)
      expect(statusLabel()).toContain("1 of 3")

      // Mutación: en la shell, no cerrar la búsqueda con Escape → rojo aquí.
      await pressEscape()
      expect(document.querySelector('section[aria-label="Find and replace"]'), "Escape cierra el panel").toBeNull()
      expect(highlightedMatches(), "cerrar limpia las decoraciones").toEqual([])
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "Replace cambia la coincidencia activa, marca sucio y llega a lo guardado",
    async () => {
      // Mutación: en `handleReplaceCurrentMatch`, despachar la transacción con
      // `isApplyingContentRef` levantado y sin `persistEditorSnapshot` (el
      // reemplazo se trata como carga de contenido) → rojo: el DOM cambia pero
      // lo guardado no.
      await openA()
      const find = await openFindPanel()
      await fillTextField(find, "gato")
      await waitFor(() => highlightedMatches().length === 3, { label: "tres coincidencias" })
      await fillTextField(replaceInput(), "perro")
      const saveLabels = recordSaveLabels()

      await pressPanelButton("Replace")

      expect(mounted!.editor().getText()).toBe("Uno perro dos gato tres gato.")
      await waitForSavedBody(writingA, (body) => body === "Uno perro dos gato tres gato.", "lleva el reemplazo")
      saveLabels.stop()
      expect(saveLabels.labels.slice(0, 1), "el reemplazo marca el documento como sucio").toEqual(["Saving..."])
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  // ODE-630: `richFindMatches` se memoriza con `editor` (misma instancia) y no
  // con el documento, así que el segundo Replace usa las posiciones de antes
  // del primero (observado: "Uno perroo dos gato tres gato."). Caracterización
  // del bug; pasa a `it` sin editar el cuerpo cuando ODE-630 se arregle.
  it.fails(
    "ODE-630 — dos Replace seguidos reemplazan dos coincidencias distintas",
    async () => {
      await openA()
      const find = await openFindPanel()
      await fillTextField(find, "gato")
      await waitFor(() => highlightedMatches().length === 3, { label: "tres coincidencias" })
      await fillTextField(replaceInput(), "perro")

      await pressPanelButton("Replace")
      await waitFor(() => highlightedMatches().length === 2, { label: "quedan dos coincidencias" })
      await pressPanelButton("Replace")

      expect(mounted!.editor().getText()).toBe("Uno perro dos perro tres gato.")
      await waitForSavedBody(writingA, (body) => body === "Uno perro dos perro tres gato.", "lleva los dos reemplazos")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "Replace all cambia todas las coincidencias y llega a lo guardado",
    async () => {
      // Mutación: en `handleReplaceAllMatches`, igual que arriba → rojo.
      await openA()
      const find = await openFindPanel()
      await fillTextField(find, "gato")
      await waitFor(() => highlightedMatches().length === 3, { label: "tres coincidencias" })
      await fillTextField(replaceInput(), "perro")
      const saveLabels = recordSaveLabels()

      await pressPanelButton("Replace all")

      expect(mounted!.editor().getText()).toBe("Uno perro dos perro tres perro.")
      await waitForSavedBody(writingA, (body) => body === "Uno perro dos perro tres perro.", "lleva los tres")
      saveLabels.stop()
      expect(saveLabels.labels.slice(0, 1), "el reemplazo marca el documento como sucio").toEqual(["Saving..."])
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  // ODE-630: al pasar a B el panel sigue con las coincidencias de A ("1 of 3")
  // y "Replace all" escribe en B con las posiciones de A, y se guarda
  // (observado: "Docuperroo B sperroa palaperrobuscada…"). Caracterización del
  // bug; pasa a `it` sin editar el cuerpo cuando ODE-630 se arregle.
  it.fails(
    "ODE-630 — al cambiar de documento, la búsqueda abierta se recalcula sobre el nuevo",
    async () => {
      // Control positivo: en A la búsqueda encuentra 3. Después de pasar a B
      // (que no contiene "gato"), ni el panel ni el editor pueden seguir
      // mostrando las coincidencias de A, y "Replace all" no puede escribir
      // en B con las posiciones de A.
      await openA()
      const find = await openFindPanel()
      await fillTextField(find, "gato")
      await waitFor(() => highlightedMatches().length === 3, { label: "tres coincidencias en A" })
      await fillTextField(replaceInput(), "perro")

      await clickEditorTab(writingB)
      await waitFor(() => mounted!.editor().getText().includes(TEXT_B), { label: "B hidratado", timeoutMs: 10_000 })
      await flush(2)

      expect(highlightedMatches(), "B no tiene coincidencias pintadas").toEqual([])
      expect(statusLabel(), "el panel no arrastra el recuento de A").not.toContain("of 3")

      const panel = document.querySelector('section[aria-label="Find and replace"]')
      const replaceAll = Array.from(panel?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
        (candidate) => (candidate.textContent ?? "").trim() === "Replace all",
      )
      if (replaceAll && !replaceAll.disabled) {
        await act(async () => {
          replaceAll.click()
        })
        await flush(2)
      }
      expect(mounted!.editor().getText(), "B sigue intacto").toBe(TEXT_B)
      await advance(500)
      expect((await localDB.writings.get(writingB))?.body_text, "lo guardado de B sigue intacto").toBe(TEXT_B)
      expect((await localDB.writings.get(writingA))?.body_text, "A tampoco cambió").toBe(TEXT_A)
    },
    TEST_TIMEOUT_MS,
  )
})
