/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-602 (corte 4a, entrega 1) — red de la tabla de contenidos (TOC)
 * A TRAVÉS de la shell, antes de mudar su cableado a un hook. El componente ya
 * tiene `tests/editor-navigation-sidebar.test.tsx`; lo que no tenía prueba es
 * la cadena extensión TableOfContents real → debounce de la shell → panel, y
 * sus dos espejos (`tableOfContentsItemsRef`, `activeTableOfContentsItemIdRef`).
 *
 *   1. La TOC refleja los encabezados del documento activo.
 *   2. Al cambiar de documento muestra los del nuevo, no los del anterior.
 *   3. Pulsar un item lleva el cursor al encabezado y lo marca como activo.
 *   4. El item activo sigue al scroll.
 *   5. Caso de coste: una ráfaga de teclas dentro de un encabezado recalcula
 *      la TOC una sola vez (el debounce de la shell), no una vez por tecla.
 *
 * Camino de producción (web): A y B abiertos como pestañas; el botón real
 * "Table of contents" de la cabecera de la hoja; gestos reales sobre las
 * pestañas. Doble declarado: happy-dom no calcula layout, así que para el
 * caso 4 se da geometría a los encabezados (`getBoundingClientRect`); el
 * cálculo del item activo, el rAF y el listener de scroll son los reales.
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
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  waitFor,
} = await import("./support/editor-shell-harness")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { createEditorSessionTab, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 30_000
/** Más que el debounce de la TOC en la shell (`TABLE_OF_CONTENTS_DEBOUNCE_MS`, 180ms). */
const TOC_SETTLE_MS = 400

const HEADINGS_A = ["Capítulo A uno", "Sección A dos", "Capítulo A tres"]
const HEADINGS_B = ["Prólogo de B", "Epílogo de B"]

let writingA = ""
let writingB = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

function heading(level: number, text: string) {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] }
}

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] }
}

function makeLocalWriting(id: string, title: string, content: Array<Record<string, unknown>>): LocalWriting {
  const bodyText = content
    .map((node) => ((node.content as Array<{ text: string }> | undefined) ?? []).map((child) => child.text).join(""))
    .join("\n")
  return {
    id,
    title,
    body_json: { type: "doc", content },
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
  await localDB.writings.save(
    makeLocalWriting(writingA, "Documento A", [
      heading(1, HEADINGS_A[0]),
      paragraph("Texto del primer capítulo de A."),
      heading(2, HEADINGS_A[1]),
      paragraph("Texto de la sección de A."),
      heading(1, HEADINGS_A[2]),
      paragraph("Cierre de A."),
    ]),
  )
  await localDB.writings.save(
    makeLocalWriting(writingB, "Documento B", [
      heading(1, HEADINGS_B[0]),
      paragraph("Texto de B."),
      heading(1, HEADINGS_B[1]),
    ]),
  )
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
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
})

async function openA() {
  mounted = await mountEditorShell({ writingId: writingA })
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await waitFor(() => mounted!.editor().getText().includes("Cierre de A."), { label: "A hidratado", timeoutMs: 10_000 })
  await waitFor(() => document.querySelector(`[data-editor-tab-id="${writingB}"]`), { label: "pestaña de B" })
}

/** Abre la TOC con el botón real de la cabecera de la hoja. */
async function openTableOfContents() {
  const toggle = await waitFor(
    () => document.querySelector<HTMLButtonElement>('button[aria-label="Table of contents"]'),
    { label: 'botón "Table of contents"' },
  )
  await act(async () => {
    toggle.click()
  })
  await flush(2)
  await waitFor(() => document.querySelector('[data-testid="editor-navigation-sidebar"][data-open="true"]'), {
    label: "TOC abierta",
  })
}

function tocNav() {
  return document.querySelector<HTMLElement>('nav[aria-label="Artifact sections"]')
}

/** Los encabezados que la TOC renderiza, en orden. */
function tocEntries() {
  return Array.from(tocNav()?.querySelectorAll<HTMLButtonElement>("button") ?? []).map((button) =>
    (button.textContent ?? "").trim(),
  )
}

function activeTocEntry() {
  return (tocNav()?.querySelector<HTMLButtonElement>('button[aria-current="location"]')?.textContent ?? "").trim() || null
}

function tocButton(text: string) {
  const button = Array.from(tocNav()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (candidate) => (candidate.textContent ?? "").trim() === text,
  )
  if (!button) throw new Error(`La TOC no tiene el item ${JSON.stringify(text)} (tiene ${JSON.stringify(tocEntries())})`)
  return button
}

/** El texto del bloque que contiene el cursor del editor real. */
function cursorBlockText() {
  const editor = mounted!.editor() as unknown as {
    state: { selection: { $from: { parent: { textContent: string; type: { name: string } } } } }
  }
  const parent = editor.state.selection.$from.parent
  return { type: parent.type.name, text: parent.textContent }
}

describe("ODE-602 — tabla de contenidos a través de la shell", () => {
  it(
    "refleja los encabezados del documento activo",
    async () => {
      await openA()
      await openTableOfContents()

      await waitFor(() => tocEntries().length === HEADINGS_A.length, { label: "la TOC lista los encabezados de A" })
      expect(tocEntries()).toEqual(HEADINGS_A)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "al cambiar de documento muestra los encabezados del nuevo, no los del anterior",
    async () => {
      // Mutación: que la TOC no se refresque al cambiar de documento (ignorar
      // en `scheduleTableOfContentsUpdate` las actualizaciones cuando ya hay
      // lista, y quitar el vaciado al cambiar `currentWritingId`) → rojo:
      // siguen los encabezados de A. Cada una por separado queda verde: la
      // extensión TableOfContents vuelve a emitir con el `setContent` del
      // documento nuevo, y ese vaciado no es la única defensa.
      await openA()
      await openTableOfContents()
      await waitFor(() => tocEntries().length === HEADINGS_A.length, { label: "TOC de A" })

      await clickEditorTab(writingB)
      await waitFor(() => mounted!.editor().getText().includes("Texto de B."), { label: "B hidratado", timeoutMs: 10_000 })
      await advance(TOC_SETTLE_MS)

      expect(tocEntries(), "la TOC es la de B").toEqual(HEADINGS_B)
      for (const stale of HEADINGS_A) {
        expect(tocNav()?.textContent ?? "", `no queda "${stale}" de A`).not.toContain(stale)
      }

      // Y de vuelta: vuelve a ser la de A.
      await clickEditorTab(writingA)
      await waitFor(() => mounted!.editor().getText().includes("Cierre de A."), { label: "A rehidratado", timeoutMs: 10_000 })
      await advance(TOC_SETTLE_MS)
      expect(tocEntries(), "la TOC vuelve a ser la de A").toEqual(HEADINGS_A)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "pulsar un item lleva el cursor a su encabezado y lo marca como activo",
    async () => {
      await openA()
      await openTableOfContents()
      await waitFor(() => tocEntries().length === HEADINGS_A.length, { label: "TOC de A" })
      // happy-dom no implementa `scrollIntoView`; la shell lo llama en un rAF
      // tras mover el cursor.
      const scrollIntoView = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoView

      await act(async () => {
        tocButton(HEADINGS_A[2]).click()
      })
      await flush(2)

      expect(cursorBlockText(), "el cursor está en el encabezado pulsado").toEqual({
        type: "heading",
        text: HEADINGS_A[2],
      })
      expect(activeTocEntry(), "el item pulsado queda activo").toBe(HEADINGS_A[2])
      await waitFor(() => scrollIntoView.mock.calls.length > 0, { label: "la shell centra el encabezado" })
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "el item activo sigue al scroll",
    async () => {
      await openA()
      await openTableOfContents()
      await waitFor(() => tocEntries().length === HEADINGS_A.length, { label: "TOC de A" })

      // Geometría (lo único que happy-dom no da): el segundo encabezado queda
      // en la línea de activación de la shell (96px bajo el borde superior);
      // el primero ya salió por arriba y el tercero está más abajo.
      const tops: Record<string, number> = {
        [HEADINGS_A[0]]: -400,
        [HEADINGS_A[1]]: 90,
        [HEADINGS_A[2]]: 500,
      }
      const realRect = Element.prototype.getBoundingClientRect
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const top = /^H[1-3]$/.test(this.tagName) ? tops[(this.textContent ?? "").trim()] : undefined
        if (top === undefined) return realRect.call(this)
        return { top, bottom: top + 30, left: 0, right: 600, width: 600, height: 30, x: 0, y: top, toJSON: () => ({}) } as DOMRect
      })

      const viewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
      await act(async () => {
        viewport?.dispatchEvent(new Event("scroll"))
        window.dispatchEvent(new Event("scroll"))
      })
      await waitFor(() => activeTocEntry() === HEADINGS_A[1], { label: "el item activo es el encabezado a la vista" })

      tops[HEADINGS_A[1]] = -300
      tops[HEADINGS_A[2]] = 100
      await act(async () => {
        window.dispatchEvent(new Event("scroll"))
      })
      await waitFor(() => activeTocEntry() === HEADINGS_A[2], { label: "el item activo sigue al scroll" })
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "caso de coste: una ráfaga de teclas en un encabezado recalcula la TOC una sola vez",
    async () => {
      // Mutación: aplicar cada actualización de la TOC en el acto, sin el
      // debounce de `scheduleTableOfContentsUpdate` → rojo: una por tecla.
      await openA()
      await openTableOfContents()
      await waitFor(() => tocEntries().length === HEADINGS_A.length, { label: "TOC de A" })
      await advance(TOC_SETTLE_MS)

      const nav = tocNav()!
      let renders = 0
      let lastText = nav.textContent
      const observer = new MutationObserver(() => {
        if (nav.textContent !== lastText) {
          renders += 1
          lastText = nav.textContent
        }
      })
      observer.observe(nav, { subtree: true, childList: true, characterData: true })

      // Cursor al final del primer encabezado y cinco teclas seguidas, sin
      // dejar que venza el debounce entre ellas.
      const editor = mounted!.editor() as unknown as {
        commands: { setTextSelection: (pos: number) => boolean; insertContent: (text: string) => boolean }
      }
      await act(async () => {
        editor.commands.setTextSelection(1 + HEADINGS_A[0].length)
      })
      for (const char of "XYZWV") {
        await act(async () => {
          editor.commands.insertContent(char)
        })
      }
      await advance(TOC_SETTLE_MS)
      observer.disconnect()

      expect(tocEntries()[0], "la TOC termina con el texto nuevo").toBe(`${HEADINGS_A[0]}XYZWV`)
      expect(renders, "un solo recálculo visible para toda la ráfaga").toBe(1)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})
