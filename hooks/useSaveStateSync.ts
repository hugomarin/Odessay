"use client"

/**
 * Estado de guardado del documento activo: la reconciliación contra el
 * catálogo durable (`reconcileActiveSaveState`) y la suscripción única a los
 * eventos de sync (documento activo y pestañas de fondo, ODE-542/ODE-590).
 *
 * ODE-605 — corte 5, paso 3 de `components/editor/editor-shell.tsx`. Es una
 * MUDANZA MECÁNICA: los cuerpos son los que vivían en la shell, con las
 * mismas dependencias, y la propiedad del estado NO cambia: el estado
 * (`syncStatus`), sus refs (`syncStatusRef`, `reconcileActiveSaveStateRef`) y
 * el único escritor `applySyncStatus` siguen siendo de la shell y llegan aquí
 * por `input` (identidades estables, así que la memoización no cambia).
 *
 * Reglas del corte:
 * - El orden de efectos no cambia: este hook se llama donde estaba la
 *   suscripción, después de los efectos de `useEditorPersistence` y antes del
 *   cleanup de desmontaje de `useDocumentExit`, así que el volcado de ODE-573
 *   corre antes de cancelar colas.
 * - Una sola suscripción por shell (caso de costo de
 *   `tests/editor-shell-durable-save-state.test.tsx`): el activo se reconcilia
 *   con una relectura durable O(1); el fondo, en `synced`, relee su fila antes
 *   de proyectar su pestaña.
 * - Sin cambio de dueño: los dueños puros (`reconcileSaveStateFromDurable`, el
 *   catálogo, el store de sesión) se consumen tal cual.
 */
import { useCallback, useEffect, type RefObject } from "react"
import type { useRouter } from "next/navigation"

import {
  formatSaveStateDiagnostic,
  mapSyncLifecycleToSaveState,
  reconcileSaveStateFromDurable,
  saveStateToHasPendingSync,
  type EditorSaveState,
} from "@/components/editor/save-state"
import type { DocumentMetadataPatch } from "@/hooks/useDocumentHydration"
import { localDB } from "@/lib/local-db"
import { getEditorSessionState, updateTabSaveState } from "@/lib/stores/editor-session-store"
import { subscribeToSyncStatusChanges } from "@/lib/sync/events"

export type SaveStateSyncInput = {
  applyDocumentMetadata: (patch: DocumentMetadataPatch) => void
  applySyncStatus: (next: EditorSaveState) => void
  currentWritingIdRef: RefObject<string | null>
  navigateToWriting: (
    router: Pick<ReturnType<typeof useRouter>, "push" | "replace">,
    href: string,
    options: { mode: "push" | "replace"; skipOnDesktop: boolean },
  ) => void
  reconcileActiveSaveStateRef: RefObject<(reason: string) => Promise<void>>
  routeWritingId: string | null
  router: ReturnType<typeof useRouter>
  syncStatusRef: RefObject<EditorSaveState>
}

export function useSaveStateSync(input: SaveStateSyncInput) {
  const {
    applyDocumentMetadata,
    applySyncStatus,
    currentWritingIdRef,
    navigateToWriting,
    reconcileActiveSaveStateRef,
    router,
    syncStatusRef,
  } = input

  /**
   * ODE-542: reconcilia el estado de guardado del documento activo (status bar
   * y su pestaña) desde el catálogo durable. Los eventos de sync son solo
   * invalidaciones: disparan esta lectura O(1), nunca fijan un estado terminal
   * por sí mismos. Un evento perdido no deja la UI atascada en "Saving…",
   * porque terminar de hidratar (también tras materializar un borrador) y el
   * `cloud-snapshot` del catálogo convergen por la misma lectura. Solo cura hacia un terminal durable, y
   * nunca borra un `error` local (ODE-461).
   */
  const reconcileActiveSaveState = useCallback(
    async (reason: string) => {
      const writingId = currentWritingIdRef.current
      if (!writingId) {
        return
      }

      try {
        const { getCatalogRecord } = await import("@/lib/queries/document-catalog")
        const record = await getCatalogRecord(writingId)
        if (!record || currentWritingIdRef.current !== writingId) {
          return
        }

        const current = syncStatusRef.current
        const next = reconcileSaveStateFromDurable({
          current,
          durable: { syncStatus: record.syncStatus, cloudPresent: record.cloudPresent },
          isOnline: typeof navigator === "undefined" ? true : navigator.onLine,
        })
        if (!next) {
          return
        }

        console.info(formatSaveStateDiagnostic({ writingId, durableSyncStatus: record.syncStatus, current, next, reason }))
        applySyncStatus(next)
        updateTabSaveState({ tabId: writingId, saveState: next, hasPendingSync: saveStateToHasPendingSync(next) })
      } catch (error) {
        // El contenido sigue abierto; el siguiente evento de sync, cambio del
        // catálogo o activación reintenta.
        console.error("[editor:save-state] reconcile read failed", {
          writingId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [applySyncStatus, currentWritingIdRef, syncStatusRef],
  )
  // Los callbacks del coordinador de persistencia se crean una vez; leen la
  // versión vigente por ref.
  useEffect(() => {
    reconcileActiveSaveStateRef.current = reconcileActiveSaveState
  }, [reconcileActiveSaveState, reconcileActiveSaveStateRef])

  // ODE-542: una sola suscripción global a los eventos de sync. La identidad
  // se resuelve por ref en el momento del evento, nunca con un
  // `currentWritingId` capturado: un `synced` que llega durante la
  // materialización o la hidratación no se pierde en la ventana de
  // re-suscripción. Los eventos son invalidaciones: el documento activo
  // relee su estado durable (O(1)); los de fondo, en `synced`, releen la fila
  // de ese documento antes de proyectar su pestaña (ODE-590).
  useEffect(() => {
    return subscribeToSyncStatusChanges((event) => {
      const activeWritingId = currentWritingIdRef.current

      if (activeWritingId && event.writingId === activeWritingId) {
        // Sin conexión no hay transición durable que releer: el commit local
        // ya es durable y la nube no está disponible. Se proyecta "Saved
        // locally" directamente, salvo que un fallo local sea dueño del
        // indicador.
        if (event.status === "offline") {
          if (syncStatusRef.current !== "error") {
            applySyncStatus("saved-local")
            updateTabSaveState({
              tabId: activeWritingId,
              saveState: "saved-local",
              hasPendingSync: saveStateToHasPendingSync("saved-local"),
            })
          }
          return
        }

        void reconcileActiveSaveStateRef.current(`sync-${event.status}`)

        if (event.status !== "synced") {
          return
        }

        void (async () => {
          const localWriting = await localDB.writings.get(activeWritingId)

          // ODE-640: el negativo inalcanzable `routeWritingId === slug` se
          // sustituye por el alcanzable "sin slug". En producción la ruta
          // entrega un UUID, nunca el slug, así que comparar ambos no
          // discriminaba ningún caso real.
          if (!localWriting?.slug) {
            return
          }

          // ODE-640: el lookup local es asíncrono y el documento activo puede
          // cambiar durante el await. Un resultado viejo de otro documento no
          // aplica metadata ni navega al activo nuevo.
          if (currentWritingIdRef.current !== activeWritingId) {
            return
          }

          applyDocumentMetadata({ slug: localWriting.slug })
          navigateToWriting(router, `/write/${localWriting.slug}`, { mode: "replace", skipOnDesktop: true })
        })()
        return
      }

      // Documento de fondo: converge su pestaña sin tocar la status bar
      // activa. ODE-590: un `synced` no basta para mostrar "Saved" — es una
      // invalidación como la del activo, así que se relee la fila durable de
      // ESE documento (O(1)) antes de proyectar. El resto de lifecycle
      // statuses no son terminales y se proyectan sin leer. Un evento perdido
      // se cura al activarlo (relectura durable tras hidratar); un `error`
      // local nunca lo borra un evento de la nube.
      const tab = getEditorSessionState().session.tabs.find(
        (candidate) => candidate.writing_id === event.writingId || candidate.id === event.writingId,
      )
      if (!tab || tab.save_state === "error") {
        return
      }

      if (event.status === "synced") {
        const tabId = tab.id
        void (async () => {
          try {
            const { getCatalogRecord } = await import("@/lib/queries/document-catalog")
            const record = await getCatalogRecord(event.writingId)
            if (!record) {
              return
            }
            // Si la pestaña pasó a ser el documento activo mientras la lectura
            // estaba en vuelo, la reconciliación activa manda: el resultado de
            // fondo no pisa el estado que esa transición ya calculó.
            if (currentWritingIdRef.current === event.writingId) {
              return
            }
            const currentTab = getEditorSessionState().session.tabs.find((candidate) => candidate.id === tabId)
            if (!currentTab || currentTab.save_state === "error") {
              return
            }
            const next = reconcileSaveStateFromDurable({
              current: currentTab.save_state,
              durable: { syncStatus: record.syncStatus, cloudPresent: record.cloudPresent },
              isOnline: typeof navigator === "undefined" ? true : navigator.onLine,
            })
            if (!next) {
              return
            }
            console.info(
              formatSaveStateDiagnostic({
                writingId: event.writingId,
                durableSyncStatus: record.syncStatus,
                current: currentTab.save_state,
                next,
                reason: "sync-synced-background",
              }),
            )
            updateTabSaveState({ tabId, saveState: next, hasPendingSync: saveStateToHasPendingSync(next) })
          } catch (error) {
            // La pestaña conserva su estado; el siguiente evento o su
            // activación reintenta.
            console.error("[editor:save-state] background reconcile read failed", {
              writingId: event.writingId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        })()
        return
      }

      const nextTabState = mapSyncLifecycleToSaveState(event.status)
      if (tab.save_state === nextTabState) {
        return
      }
      updateTabSaveState({
        tabId: tab.id,
        saveState: nextTabState,
        hasPendingSync: saveStateToHasPendingSync(nextTabState),
      })
    })
  }, [
    applyDocumentMetadata,
    applySyncStatus,
    currentWritingIdRef,
    navigateToWriting,
    reconcileActiveSaveStateRef,
    router,
    syncStatusRef,
  ])
}
