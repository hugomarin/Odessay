/**
 * @vitest-environment happy-dom
 *
 * ODE-609 — `editorInstanceRef` tiene un solo dueño: se escribe en el render
 * que adopta la instancia devuelta por `useEditor` (el mismo patrón que
 * `routerRef`), no en un efecto espejo.
 *
 * Property ("leído entre render y efecto"): en cada commit del shell el ref ya
 * vale la instancia que ese commit adopta. Con el espejo, el commit que adopta
 * el editor —la creación de `useEditor`, `null` → instancia— tiene el ref
 * todavía en `null`, porque el efecto pasivo que lo copia llega después: un
 * lector que corra en esa ventana (fase de layout, callback síncrono del
 * commit) trabaja sin editor. Con el dueño, el ref ve la instancia nueva en el
 * mismo commit.
 *
 * Técnica: `world.onShellCommit` (el layout effect del doble de `useEditor`)
 * corre en la fase de layout de cada commit, después del commit y antes de sus
 * efectos pasivos. La sonda lee el `editorInstanceRef` real de la shell
 * —capturado por `createCorrectionBlocksCaptureModule`, que envuelve a su
 * primer consumidor sin cambiar su comportamiento— y lo compara con la
 * instancia que ese commit acogió (`world.editor`), como la leen hoy
 * `useCorrectionBlocks.ts:99`/`:168`, `useExternalDocumentChanges.ts:241` y
 * `useManualCorrections.ts:183`/`:385`.
 *
 * Camino de producción: montaje real de la shell con un documento real de
 * `fake-indexeddb`; el editor es el de TipTap con sus extensiones reales.
 *
 * Mutation test (ODE-609): quitar el escritor del render y devolver el efecto
 * espejo de `main` (`useEffect(() => { editorInstanceRef.current = editor ??
 * null }, [editor])`) deja el ref en `null` en el primer commit que adopta el
 * editor → cae la lectura rezagada, no otra cosa. Límite declarado: añadir el
 * espejo *junto al dueño* queda verde —el dueño escribe antes y el espejo
 * pasivo repite el mismo valor—, así que la fase roja fiel es volver al código
 * de `main`.
 *
 * Límite declarado (recreación con la shell montada): no es un caso verde
 * construible hoy. `editorExtensions` y `handleEditorUpdate` son estables
 * mientras la shell vive —sus entradas son refs y callbacks estables—, así que
 * `useEditor` no refresca la instancia por ningún camino de producción; el
 * único disparador disponible en un test es `createDesktopDraftOverride`, el
 * prop del harness de perf. Forzarlo recrea el editor de verdad (instancia
 * nueva, `isDestroyed` sobre la vieja), pero la shell rompe antes de poder
 * asertar: el cleanup de `useCorrectionLifecycle.ts:313` hace `editor.view.dom`
 * sobre el editor viejo ya destruido y lanza `[tiptap error]: The editor view
 * is not available`. Es un defecto de recreación preexistente, ajeno a este ref
 * (usa el cierre `editor`, no `editorInstanceRef`), y queda fuera del alcance
 * de este PR. La ventana de creación es la misma propiedad de dueño y sí es
 * alcanzable: cada montaje de la shell la recorre.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("@/hooks/useCorrectionBlocks", async (importOriginal) => {
  const { createCorrectionBlocksCaptureModule } = await import("./support/editor-shell-doubles")
  return createCorrectionBlocksCaptureModule(await importOriginal<Record<string, unknown>>())
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

const { mountEditorShell, resetEditorShellWorld, waitFor, world } = await import(
  "./support/editor-shell-harness"
)

const TEST_TIMEOUT_MS = 40_000
const TEXT = "Texto del documento con un editor propio."

function makeLocalWriting(id: string, bodyText: string, title: string): LocalWriting {
  return {
    id,
    title,
    body_json: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }],
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

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let writingId = ""

beforeEach(async () => {
  writingId = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingId, TEXT, "Documento con editor"))
})

afterEach(async () => {
  world.onShellCommit = null
  await mounted?.unmount()
  mounted = null
})

type Reading = {
  /** El ref, leído como lo leen los consumidores. */
  refValue: "sin-ref" | "null" | "el-adoptado" | "otro" | "destruido"
}

describe("ODE-609 — editorInstanceRef se lee entre el render y el efecto", () => {
  it(
    "cada commit que adopta el editor ya lo tiene escrito en el ref",
    async () => {
      const readings: Reading[] = []

      // Lector: corre en la fase de layout de cada commit del shell, con la
      // instancia de ese commit ya adoptada y los efectos pasivos todavía sin
      // correr. Es la ventana en la que un espejo va un render por detrás.
      world.onShellCommit = () => {
        const captured = world.shellEditorInstanceRef
        const adopted = world.editor
        if (!captured) {
          readings.push({ refValue: "sin-ref" })
          return
        }
        if (!adopted) {
          return
        }
        const live = captured.current
        if (live === null) {
          readings.push({ refValue: "null" })
          return
        }
        if (live !== adopted) {
          readings.push({ refValue: "otro" })
          return
        }
        readings.push({ refValue: live.isDestroyed ? "destruido" : "el-adoptado" })
      }

      mounted = await mountEditorShell({ writingId })
      await waitFor(() => mounted!.editor().getText().includes(TEXT), { label: "documento hidratado" })
      world.onShellCommit = null

      const stale = readings.filter((reading) => reading.refValue !== "el-adoptado")
      expect(
        readings.length,
        "la sonda corrió en commits con el editor ya adoptado (control positivo)",
      ).toBeGreaterThan(0)
      expect(
        stale,
        "ningún commit leyó un ref rezagado: la creación (y cualquier recreación) ya está en el ref antes del efecto pasivo",
      ).toEqual([])
    },
    TEST_TIMEOUT_MS,
  )
})
