"use client"

/**
 * La copia de la pestaña activa del store de sesión, con un **único escritor**:
 * la suscripción síncrona al store (ODE-609, opción B de ODE-608).
 *
 * Por qué existe: `activeEditorTabIdRef` era un espejo por efecto —un render
 * por detrás— con cuatro escrituras manuales que tapaban el retraso en los
 * caminos del editor. Los caminos que cambian `active_tab_id` sin escritura
 * manual (`initializeEditorSessionStore` con el replay de ODE-577,
 * `reconcileMaterializedDraftTab`, `reconcileUnavailableWritingTab`,
 * `publishTabState`, `openWritingTab` de la restauración) solo los ve una
 * suscripción al store. `setSessionState` emite en el acto, así que la copia y
 * el cambio del store caen en la misma instrucción.
 *
 * Orden de la suscripción: se suscribe y **después** re-lee el estado. Un
 * cambio entre el render y este efecto ya emitió al listener recién
 * registrado; la re-lectura cubre el que ocurrió antes de suscribir. Al revés
 * se perdería. Se desuscribe al desmontar; en StrictMode se suscribe dos veces
 * sin efectos secundarios.
 */
import { useEffect, useRef } from "react"

import { getEditorSessionState, subscribeToEditorSessionStore } from "@/lib/stores/editor-session-store"

export function useActiveEditorTabIdRef() {
  const activeEditorTabIdRef = useRef<string | null>(getEditorSessionState().session.active_tab_id)

  useEffect(() => {
    const sync = () => {
      activeEditorTabIdRef.current = getEditorSessionState().session.active_tab_id
    }

    const unsubscribe = subscribeToEditorSessionStore(sync)
    sync()

    return unsubscribe
  }, [])

  return activeEditorTabIdRef
}
