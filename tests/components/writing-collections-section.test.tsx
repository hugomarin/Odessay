/** @vitest-environment happy-dom */
/**
 * ODE-643 — un solo escritor síncrono para `selectedIds` y `selectedIdsRef`
 * en el panel de colecciones del editor.
 *
 * La prueba central cubre la ventana commit → efectos pasivos: el picker REAL
 * se envuelve con un `useLayoutEffect` sin deps que dispara toggles encolados
 * justo después del commit y antes de los efectos pasivos. Con el espejo
 * pasivo (`useEffect` 40-42), el toggle de B queda pisado por el espejo del
 * commit anterior y C se calcula sobre el ref viejo: la selección termina en
 * [A, C]. Con el escritor único termina en [A, B, C].
 *
 * Fase roja de BUILD (mutación del modo de fallo): este test corre primero
 * como `it` contra el espejo y falla con `Collections (2)` / `[A, C]`.
 * Guía de review: restaurar el efecto 40-42 pone en rojo el ratchet
 * (`tests/architecture/editor-shell-mirrors-ratchet.test.ts`) y este test.
 *
 * El cruce de escritura al cambiar de documento (Decisión de Hugo) queda como
 * `it.fails` con "follow-up pendiente (ODE-643)": no se arregla aquí.
 */
import "fake-indexeddb/auto"

import type { ReactNode } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WritingCollectionsSection } from "@/components/editor/panels/writing-collections-section"
import { localDB } from "@/lib/local-db"
import type { LocalCollection } from "@/lib/local-db/schema"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const probe = vi.hoisted(() => ({
  plan: [] as Array<{ when: string[]; action: () => void }>,
  windowReads: 0,
}))

// Mismo mock inline de Popover que tests/components/properties-panel-export.test.tsx.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}))

// La nube es el boundary: `hydrateCollections` no toca red en este test.
vi.mock("@/lib/sync", () => ({
  getSyncService: () => ({
    hydrateCollections: async () => ({ data: null, error: null }),
    scheduleFlush: () => {},
  }),
}))

vi.mock("@/components/collections/collection-assignment-menu", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/collections/collection-assignment-menu")
  >()
  const React = await import("react")
  return {
    ...actual,
    CollectionAssignmentMenu: (props: Parameters<typeof actual.CollectionAssignmentMenu>[0]) => {
      // Corre en fase de layout de cada commit: después del commit y antes de
      // los efectos pasivos. `when` se compara contra las props ya commiteadas.
      React.useLayoutEffect(() => {
        const next = probe.plan[0]
        if (!next || JSON.stringify(next.when) !== JSON.stringify(props.selectedIds)) return
        probe.plan.shift()
        probe.windowReads += 1
        next.action()
      })
      return React.createElement(actual.CollectionAssignmentMenu, props)
    },
  }
})

let container: HTMLDivElement
let root: Root | null = null
let sequence = 0

function uniqueId(prefix: string): string {
  sequence += 1
  return `ode643-${prefix}-${Date.now()}-${sequence}`
}

async function seedCollection(label: string): Promise<{ id: string; name: string }> {
  const id = uniqueId("col")
  const name = `${label} ${id.slice(-6)}`
  const timestamp = new Date().toISOString()
  await localDB.collections.save({
    id,
    owner_id: null,
    name,
    description: null,
    visibility: "private",
    sync_status: "synced",
    lifecycle: "server-confirmed",
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    local_updated_at: Date.now(),
  } satisfies LocalCollection)
  return { id, name }
}

async function flush(rounds = 3): Promise<void> {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })
}

async function waitFor<T>(read: () => T | null, label: string, timeoutMs = 8000): Promise<T> {
  const startedAt = Date.now()
  for (;;) {
    const value = read()
    if (value !== null) return value
    if (Date.now() - startedAt > timeoutMs) throw new Error(`waitFor agotó ${timeoutMs}ms: ${label}`)
    await flush(1)
  }
}

async function waitForAsync<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 8000,
): Promise<T> {
  const startedAt = Date.now()
  for (;;) {
    const value = await read()
    if (predicate(value)) return value
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`waitForAsync agotó ${timeoutMs}ms: ${label}`)
    }
    await flush(1)
  }
}

function findButtonOrNull(text: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.trim() === text,
    ) ?? null
  )
}

function findButton(text: string): HTMLButtonElement {
  const button = findButtonOrNull(text)
  if (!button) {
    throw new Error(
      `No hay botón "${text}". Botones: ${Array.from(container.querySelectorAll("button"))
        .map((element) => element.textContent?.trim())
        .join(", ")}`,
    )
  }
  return button
}

function triggerText(): string | null {
  const button = Array.from(container.querySelectorAll("button")).find((element) => {
    const text = element.textContent?.trim() ?? ""
    return text === "Add to collections" || /^Collections \(\d+\)$/.test(text)
  })
  return button?.textContent?.trim() ?? null
}

function renderSection(writingId: string): void {
  act(() => {
    root?.render(<WritingCollectionsSection writingId={writingId} />)
  })
}

async function clickButton(text: string): Promise<void> {
  await act(async () => {
    findButton(text).click()
  })
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

async function readIds(writingId: string): Promise<string[]> {
  const rows = await localDB.writingCollections.listForWriting(writingId)
  return rows.map((row) => row.collection_id)
}

/** Espera a que la persistencia y la recarga por suscripción se asienten. */
async function waitForSettledIds(writingId: string, timeoutMs = 8000): Promise<string[]> {
  const startedAt = Date.now()
  let previous = (await readIds(writingId)).sort()
  for (;;) {
    await flush(2)
    const current = (await readIds(writingId)).sort()
    const stable =
      current.length === previous.length && current.every((id, index) => id === previous[index])
    if (stable) return current
    previous = current
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`waitForSettledIds agotó ${timeoutMs}ms: ${writingId}`)
    }
  }
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  probe.plan.length = 0
  probe.windowReads = 0
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
})

describe("WritingCollectionsSection — un solo escritor de selectedIds (ODE-643)", () => {
  it("refleja la selección persistida al cargar y la mantiene viva", async () => {
    const writingId = uniqueId("writing")
    const alpha = await seedCollection("Alpha")
    await localDB.writingCollections.replaceForWriting(writingId, [alpha.id])

    renderSection(writingId)
    await waitFor(() => (triggerText() === "Collections (1)" ? true : null), "selección cargada")

    await clickButton(alpha.name)
    await waitForAsync(() => readIds(writingId), (ids) => ids.length === 0, "quitar la asignación")
    await waitFor(() => (triggerText() === "Add to collections" ? true : null), "UI sin asignaciones")
  }, 15_000)

  it("toggle agrega y quita la asignación sin duplicarla", async () => {
    const writingId = uniqueId("writing")
    const beta = await seedCollection("Beta")

    renderSection(writingId)
    await waitFor(() => findButtonOrNull(beta.name), "picker con la colección")

    await clickButton(beta.name)
    await waitForAsync(() => readIds(writingId), (ids) => ids.includes(beta.id), "asignación")
    expect(triggerText()).toBe("Collections (1)")

    await clickButton(beta.name)
    await waitForAsync(() => readIds(writingId), (ids) => !ids.includes(beta.id), "remoción")
    await waitFor(() => (triggerText() === "Add to collections" ? true : null), "UI sin asignaciones")
  }, 15_000)

  it("crear una colección desde el picker la asigna al documento", async () => {
    const writingId = uniqueId("writing")
    const name = `Delta ${uniqueId("name")}`

    renderSection(writingId)
    await waitFor(() => findButtonOrNull("New collection"), "picker")

    await clickButton("New collection")
    const input = await waitFor(
      () => container.querySelector<HTMLInputElement>("#collection-name"),
      "campo de nombre",
    )
    setNativeInputValue(input, name)
    await clickButton("Create")

    const ids = await waitForAsync(
      () => readIds(writingId),
      (value) => value.length === 1,
      "colección creada y asignada",
    )
    const created = (await localDB.collections.getAll()).find((collection) => collection.name === name)
    expect(created).toBeDefined()
    expect(ids).toEqual([created?.id])
  }, 15_000)

  it("cambia la selección al cambiar de documento", async () => {
    const firstWritingId = uniqueId("writing")
    const secondWritingId = uniqueId("writing")
    const alpha = await seedCollection("Alpha")
    const beta = await seedCollection("Beta")
    await localDB.writingCollections.replaceForWriting(firstWritingId, [alpha.id])
    await localDB.writingCollections.replaceForWriting(secondWritingId, [beta.id])

    renderSection(firstWritingId)
    await waitFor(() => (triggerText() === "Collections (1)" ? true : null), "carga del primero")

    act(() => {
      root?.render(<WritingCollectionsSection writingId={secondWritingId} />)
    })
    await waitForAsync(
      () => readIds(secondWritingId),
      (ids) => ids.includes(beta.id),
      "carga del segundo",
    )

    // Si el panel todavía tuviera la selección del primero, este toggle
    // agregaría Beta en vez de quitarla.
    await clickButton(beta.name)
    await waitForAsync(() => readIds(secondWritingId), (ids) => ids.length === 0, "segundo vacío")
    expect(await readIds(firstWritingId)).toEqual([alpha.id])
  }, 15_000)

  it("recarga cuando las asignaciones cambian por fuera del panel", async () => {
    const writingId = uniqueId("writing")
    const alpha = await seedCollection("Alpha")

    renderSection(writingId)
    await waitFor(() => findButtonOrNull(alpha.name), "picker con la colección")

    await act(async () => {
      await localDB.writingCollections.replaceForWriting(writingId, [alpha.id])
    })
    await waitFor(() => (triggerText() === "Collections (1)" ? true : null), "recarga por suscripción")
  }, 15_000)

  it.fails("conserva el toggle encolado en la ventana commit → efectos pasivos", async () => {
    const writingId = uniqueId("writing")
    const alpha = await seedCollection("Alpha")
    const beta = await seedCollection("Beta")
    const gamma = await seedCollection("Gamma")

    renderSection(writingId)
    await waitFor(() => findButtonOrNull(alpha.name), "picker con las colecciones")

    // En la ventana de [A] se clickea B; en la de [A, B], C. El espejo pasivo
    // pisa el ref con [A] entre ambos commits y el toggle de C pierde B.
    probe.plan.push(
      { when: [alpha.id], action: () => findButton(beta.name).click() },
      { when: [alpha.id, beta.id], action: () => findButton(gamma.name).click() },
    )

    await act(async () => {
      findButton(alpha.name).click()
    })
    await flush(4)

    expect(
      probe.windowReads,
      "control positivo: los toggles encolados corrieron en la ventana commit → pasivos",
    ).toBeGreaterThanOrEqual(2)
    const finalIds = await waitForSettledIds(writingId)
    expect(finalIds).toEqual([alpha.id, beta.id, gamma.id].sort())
    await waitFor(() => (triggerText() === "Collections (3)" ? true : null), "UI con las tres")
  }, 15_000)

  it.fails(
    "no cruza la selección del documento anterior al nuevo durante su carga (follow-up pendiente (ODE-643))",
    async () => {
      const firstWritingId = uniqueId("writing")
      const secondWritingId = uniqueId("writing")
      const alpha = await seedCollection("Alpha")
      const beta = await seedCollection("Beta")
      await localDB.writingCollections.replaceForWriting(firstWritingId, [alpha.id])

      renderSection(firstWritingId)
      await waitFor(() => (triggerText() === "Collections (1)" ? true : null), "carga del primero")

      // Sin key, el panel sobrevive al cambio de documento: un toggle en la
      // ventana de la carga nueva escribe en el writingId nuevo con los ids
      // del anterior (ref todavía [A]).
      probe.plan.push({ when: [alpha.id], action: () => findButton(beta.name).click() })
      act(() => {
        root?.render(<WritingCollectionsSection writingId={secondWritingId} />)
      })
      await flush(4)

      expect(probe.windowReads).toBeGreaterThanOrEqual(1)
      const crossWritten = await waitForSettledIds(secondWritingId)
      expect(crossWritten).toEqual([beta.id])
    },
    15_000,
  )
})
