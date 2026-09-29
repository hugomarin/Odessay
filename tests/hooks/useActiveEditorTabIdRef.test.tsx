/**
 * @vitest-environment happy-dom
 *
 * ODE-609 — la **re-lectura al suscribirse** de `useActiveEditorTabIdRef`.
 *
 * El efecto del hijo corre **antes** que el del padre (entre el render del
 * padre y su efecto de suscripción), así que un hijo que llama a
 * `openWritingTab` muta el store en esa ventana. El listener del hook todavía
 * no está registrado y `useRef` ya capturó el valor del render (null): sin la
 * re-lectura posterior a `subscribe`, la copia se queda en el valor viejo.
 * En la shell el caso queda enmascarado porque el efecto de `publishTabState`
 * —declarado después— vuelve a emitir en el mismo flush; aquí se aísla.
 *
 * Mutation test (ODE-609): borrar `sync()` de
 * `hooks/useActiveEditorTabIdRef.ts:35` → rojo, `expected null to be
 * 'w-between'`. Con `sync()`: verde. (Fase corrida en el fix ciclo 1.)
 */
import "fake-indexeddb/auto"
import { act, useEffect, type RefObject } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { useActiveEditorTabIdRef } from "@/hooks/useActiveEditorTabIdRef"
import { localDB, setLocalDBScope } from "@/lib/local-db"
import { createEmptyEditorSession } from "@/lib/local-db/editor-sessions"
import {
  getEditorSessionState,
  openWritingTab,
  resetEditorSessionStoreForTests,
} from "@/lib/stores/editor-session-store"
import { resetStudioSessionForTests } from "@/lib/stores/studio-session-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WRITING_ID = "w-between"

let container: HTMLDivElement
let root: Root
let capturedRef: RefObject<string | null> | null = null

function MutatingChild() {
  useEffect(() => {
    openWritingTab({ writingId: WRITING_ID, title: "Mutado antes de suscribir" })
  }, [])
  return null
}

function Parent({ onRef }: { onRef: (ref: RefObject<string | null>) => void }) {
  const ref = useActiveEditorTabIdRef()
  onRef(ref)
  return <MutatingChild />
}

beforeEach(async () => {
  resetEditorSessionStoreForTests()
  resetStudioSessionForTests()
  setLocalDBScope(`ode609-active-tab-ref-${crypto.randomUUID()}`)
  await localDB.editorSessions.save(createEmptyEditorSession())
  capturedRef = null
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("useActiveEditorTabIdRef — re-lectura al suscribirse", () => {
  it("un cambio del store en el efecto del hijo queda cubierto por la re-lectura", async () => {
    await act(async () => {
      root.render(<Parent onRef={(ref) => (capturedRef = ref)} />)
    })

    expect(capturedRef, "el padre expuso el ref").not.toBeNull()
    expect(getEditorSessionState().session.active_tab_id).toBe(WRITING_ID)
    expect(capturedRef!.current).toBe("w-between")
  })
})