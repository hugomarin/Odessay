/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-602 (corte 4a, entrega 1) — red del visor de imagen y de los
 * modales de renombrar e insertar imagen A TRAVÉS de la shell, antes de mudar
 * su cableado a hooks.
 *
 *   1. El visor de imagen abre con la imagen pulsada y cierra; cambiar de
 *      documento lo cierra.
 *   2. El modal de renombrar actúa sobre el documento activo: tras pasar de A
 *      a B, el nombre nuevo se guarda en B y A no cambia.
 *   3. El modal de insertar imagen actúa sobre el documento activo: la subida
 *      va al documento activo y la imagen llega a lo guardado de ese
 *      documento, no al anterior.
 *
 * Camino de producción (web): A y B abiertos como pestañas; el botón real
 * "Open image viewer" del node view de la imagen; el lápiz "Rename artifact"
 * de la cabecera de la hoja; el atajo real de insertar imagen (⌘⇧I /
 * Ctrl+Shift+I) y el formulario real del modal. Persistencia real sobre
 * fake-indexeddb. Dobles: la red (la subida de la imagen es un POST a
 * `/api/writings/:id/images`, boundary externo) y el proveedor de AI.
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
  resetEditorShellWorld,
  waitFor,
  world,
} = await import("./support/editor-shell-harness")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { createEditorSessionTab, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 30_000
const TEXT_A = "Documento A con dos imágenes."
const TEXT_B = "Documento B, sin imágenes."
const IMAGE_ONE = "https://images.example.test/uno.png"
const IMAGE_TWO = "https://images.example.test/dos.png"
const UPLOADED_URL = "https://images.example.test/subida.png"

let writingA = ""
let writingB = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

function makeLocalWriting(
  id: string,
  title: string,
  bodyText: string,
  extra: Array<Record<string, unknown>> = [],
): LocalWriting {
  return {
    id,
    title,
    body_json: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }, ...extra],
    },
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
    makeLocalWriting(writingA, "Documento A", TEXT_A, [
      { type: "image", attrs: { src: IMAGE_ONE, alt: "Primera" } },
      { type: "image", attrs: { src: IMAGE_TWO, alt: "Segunda" } },
    ]),
  )
  await localDB.writings.save(makeLocalWriting(writingB, "Documento B", TEXT_B))
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

async function switchToB() {
  await clickEditorTab(writingB)
  await waitFor(() => mounted!.editor().getText().includes(TEXT_B), { label: "B hidratado", timeoutMs: 10_000 })
  await flush(2)
}

function viewerPanel() {
  return document.querySelector<HTMLElement>('[data-testid="image-presentation-panel"]')
}

function viewerImage() {
  return document.querySelector<HTMLImageElement>('[data-testid="image-presentation-panel"] img')
}

function buttonWithText(text: string, root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => (candidate.textContent ?? "").trim() === text && !candidate.classList.contains("sr-only"),
  )
}

async function waitForSaved(writingId: string, predicate: (record: LocalWriting) => boolean, label: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const record = await localDB.writings.get(writingId)
    if (record && predicate(record)) return record
    await advance(100)
  }
  const record = await localDB.writings.get(writingId)
  throw new Error(`Lo guardado de ${writingId} nunca cumplió: ${label} (${JSON.stringify(record?.title)})`)
}

function imageSources(record: LocalWriting | null | undefined) {
  const content = ((record?.body_json as { content?: Array<{ type: string; attrs?: { src?: string } }> })?.content ?? [])
  return content.filter((node) => node.type === "image").map((node) => node.attrs?.src)
}

describe("ODE-602 — visor de imagen a través de la shell", () => {
  it(
    "abre con la imagen pulsada, cierra, y cambiar de documento lo cierra",
    async () => {
      await openA()
      const openers = await waitFor(
        () => {
          const buttons = mounted!.prosemirror()?.querySelectorAll<HTMLButtonElement>('button[aria-label="Open image viewer"]')
          return buttons && buttons.length === 2 ? Array.from(buttons) : null
        },
        { label: "los dos node views de imagen" },
      )

      // La segunda imagen: el visor tiene que abrir en ella, no en la primera.
      await act(async () => {
        openers[1].click()
      })
      await waitFor(() => viewerImage(), { label: "el visor muestra una imagen" })
      expect(viewerImage()!.getAttribute("src"), "la imagen pulsada").toBe(IMAGE_TWO)

      const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close viewer"]')
      expect(close, 'el botón "Close viewer"').toBeTruthy()
      await act(async () => {
        close!.click()
      })
      await flush(2)
      expect(viewerPanel(), "el visor se cerró").toBeNull()

      // Reabrir en la primera y cambiar de documento con el visor abierto.
      await act(async () => {
        openers[0].click()
      })
      await waitFor(() => viewerImage()?.getAttribute("src") === IMAGE_ONE, { label: "el visor abre en la primera" })
      // Con el visor abierto la barra de pestañas queda tapada (y un
      // pointerdown fuera del overlay lo cierra por sí solo), así que el
      // cambio de documento llega por el atajo de pestaña siguiente.
      // Mutación: quitar el efecto que limpia `imageViewerSource` al cambiar
      // `currentWritingId` → rojo: el visor sigue abierto sobre B.
      await pressEditorShortcut({ key: "]", code: "BracketRight", shift: true })
      await waitFor(() => mounted!.editor().getText().includes(TEXT_B), { label: "B hidratado", timeoutMs: 10_000 })
      await flush(2)
      expect(viewerPanel(), "cambiar de documento cierra el visor").toBeNull()
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

describe("ODE-602 — modales sobre el documento activo", () => {
  it(
    "renombrar tras pasar de A a B guarda el nombre en B y deja A intacto",
    async () => {
      // Mutación: en `handleRenameWritingConfirm` (web), persistir contra el
      // documento de la ruta (A) en vez del activo → rojo.
      await openA()
      await switchToB()

      const pencil = document.querySelector<HTMLButtonElement>('button[aria-label="Rename artifact"]')
      expect(pencil, 'el lápiz "Rename artifact" de la hoja').toBeTruthy()
      await act(async () => {
        pencil!.click()
      })
      const input = await waitFor(() => document.querySelector<HTMLInputElement>('input[aria-label="Artifact name"]'), {
        label: "el modal de renombrar",
      })
      expect(input.value, "el modal abre con el nombre de B").toBe("Documento B")
      await fillTextField(input, "B renombrado")
      const save = buttonWithText("Save name")
      expect(save, 'el botón "Save name"').toBeTruthy()
      await act(async () => {
        save!.click()
      })
      await flush(2)

      await waitForSaved(writingB, (record) => record.title === "B renombrado", "B lleva el nombre nuevo")
      await waitFor(() => !document.querySelector('input[aria-label="Artifact name"]'), { label: "el modal se cierra" })
      expect((await localDB.writings.get(writingA))?.title, "A conserva su nombre").toBe("Documento A")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "insertar imagen tras pasar de A a B sube a B y la imagen llega a lo guardado de B",
    async () => {
      // Mutación: dar al modal el `writingId` de la ruta (A) en vez del
      // activo → rojo: la subida va a A.
      const uploads: string[] = []
      world.network = (url, init) => {
        const match = url.match(/\/api\/writings\/([^/]+)\/images$/)
        if (match && (init?.method ?? "GET").toUpperCase() === "POST") {
          uploads.push(match[1])
          return new Response(
            JSON.stringify({ data: { assetId: "asset-1", url: UPLOADED_URL, alt: "Subida" }, error: null }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        return new Response(JSON.stringify({ error: "network disabled in harness" }), { status: 503 })
      }

      await openA()
      await switchToB()
      // Cursor al final de B, donde irá la imagen.
      await act(async () => {
        ;(mounted!.editor().commands as unknown as { focus: (pos: string) => boolean }).focus("end")
      })

      await pressEditorShortcut({ key: "I", code: "KeyI", shift: true })
      const fileInput = await waitFor(() => document.querySelector<HTMLInputElement>('input[type="file"]'), {
        label: "el modal de insertar imagen",
      })
      const file = new File([new Uint8Array([137, 80, 78, 71])], "subida.png", { type: "image/png" })
      Object.defineProperty(fileInput, "files", { configurable: true, value: [file] })
      await act(async () => {
        fileInput.dispatchEvent(new Event("change", { bubbles: true }))
      })
      await flush(2)

      const submit = await waitFor(
        () => {
          const button = buttonWithText("Insert image")
          return button && !button.disabled ? button : null
        },
        { label: 'botón "Insert image" habilitado' },
      )
      // El submit del formulario real. happy-dom aplica la validación nativa
      // del `required` mirando `value`, que en un `<input type="file">` no se
      // puede asignar desde el test: se entrega el evento `submit` que el
      // navegador emitiría con el archivo elegido.
      await act(async () => {
        submit.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      })
      await waitFor(() => uploads.length === 1, { label: "la subida salió a la red" })
      expect(uploads, "la subida va al documento activo").toEqual([writingB])

      await waitFor(() => !document.querySelector('input[type="file"]'), { label: "el modal se cierra" })
      const savedB = await waitForSaved(
        writingB,
        (record) => imageSources(record).includes(UPLOADED_URL),
        "B lleva la imagen subida",
      )
      expect(imageSources(savedB)).toEqual([UPLOADED_URL])
      expect(imageSources(await localDB.writings.get(writingA)), "A conserva sus dos imágenes").toEqual([
        IMAGE_ONE,
        IMAGE_TWO,
      ])
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})
