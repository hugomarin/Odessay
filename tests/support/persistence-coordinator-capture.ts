import type { PersistenceCoordinator } from "@/lib/editor/persistence-coordinator"

type CaptureState = {
  coordinators: Set<PersistenceCoordinator>
}

export type PersistenceCoordinatorCapture = {
  settle(): Promise<boolean>
  stop(): void
}

let activeCapture: CaptureState | null = null

export function recordPersistenceCoordinator(coordinator: PersistenceCoordinator) {
  activeCapture?.coordinators.add(coordinator)
}

export function beginPersistenceCoordinatorCapture(): PersistenceCoordinatorCapture {
  const state: CaptureState = { coordinators: new Set() }
  activeCapture = state

  return {
    async settle() {
      if (state.coordinators.size === 0) {
        throw new Error("No se capturó un PersistenceCoordinator real durante el montaje")
      }
      const results = await Promise.all(Array.from(state.coordinators, (coordinator) => coordinator.settle()))
      return results.every(Boolean)
    },
    stop() {
      if (activeCapture === state) activeCapture = null
    },
  }
}
