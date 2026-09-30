/** @vitest-environment happy-dom */
/**
 * WS-06 — Workspace switch isolation: Workspace A's view state must not
 * contaminate Workspace B, and each root's documents/collections stay scoped
 * to its own view.
 *
 * Proof Contract (workflow/quality/capability-proof-contract.md):
 *
 * - **Entry points (rule 1).** The two runtime entries the human decision of
 *   2026-09-30 names:
 *   - desktop: the real `?slug=` route — the sidebar `Link`
 *     (`components/navigation/sidebar.tsx:732`) lands on `/workspace?slug=…`,
 *     which renders `DesktopWorkspaceEntry` → `<WorkspaceDetail
 *     key={workspaceSlug}>`. Driven by changing `world.searchParams`, exactly
 *     the URL the product navigates to.
 *   - web: `app/(app)/workspace/[slug]/page.tsx`, which is a server component
 *     whose only job is to render `<WorkspaceDetail workspaceSlug={slug} />`
 *     WITHOUT a key. A server component cannot be rendered by `createRoot`, so
 *     the test renders the same element that page renders and changes its prop
 *     across renders — React preserves the instance, which is exactly what
 *     "sin remontar" means. What is lost by not entering through the Next.js
 *     router itself is only the RSC plumbing; the client component, its
 *     effects and its state lifetime are the ones under test.
 *
 * - **Transition sequence (rule 2).** Two real, distinct temp directories are
 *   registered as the real production shape (a `WorkspaceRecord` + a
 *   `BindingRoot` each). Each root gets documents through production's own
 *   path (`createDesktopDraft` → `DesktopWorkspaceService.assignToWorkspace`)
 *   and collections through `createAndAssignCollection` — the same function
 *   the view's own "create collection" action calls. Both roots hold a
 *   document with the same filename (`notes.md`, different UUIDs).
 *
 * - **Real seams (rule 3).** `WorkspaceDetail`, `DesktopWorkspaceEntry`, the
 *   real services, the real in-memory catalog/manifest/collection doubles of
 *   `support/real-desktop-doubles.ts` — only the Tauri IPC transport (and the
 *   Supabase flush, a genuinely external boundary) are doubled.
 *
 * - **Completion event (rule 4).** `loadWorkspace` resolving for the new slug:
 *   the assertions wait for the header and the rows of B, never for the
 *   navigation click.
 *
 * - **Canonical outcome (rule 6).** Rendered DOM: visible rows, filter/group/
 *   sort trigger labels, collection chips, selection bar.
 *
 * - **Positive control first (rule 8).** A sibling test proves each piece of
 *   view state visibly changes A; the isolation tests assert an absence only
 *   after that control. On web the absence is expected to fail — the same
 *   instance survives the slug change and nothing resets it — so that test is
 *   `it.fails` and the real leak is tracked as ODE-646 (linked to ODE-614).
 *   Desktop's remount-by-key behavior is proven, not assumed.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import {
  resetCatalogDoubles,
  resetSettingsStoreDouble,
  tauriPathModuleDouble,
} from "./support/real-desktop-doubles"
import {
  bodyJson,
  configureTwoWorkspaceBase,
  registerTwoWorkspaces,
  type TwoWorkspaceBase,
} from "./support/two-workspace-montage"

vi.mock("@tauri-apps/api/path", () => tauriPathModuleDouble)

vi.mock("@tauri-apps/plugin-dialog", async () => {
  const { unimplemented } = await import("./support/two-workspace-montage")
  return { open: unimplemented("open (native folder picker)") }
})

vi.mock("@/lib/services/desktop/tauri-commands", async () => {
  const { tauriCommandsModuleDouble } = await import("./support/two-workspace-montage")
  const doubles = await import("./support/real-desktop-doubles")
  return tauriCommandsModuleDouble({
    tauriCatalogListCollectionSnapshot: doubles.tauriCatalogListCollectionSnapshotDouble,
    tauriCatalogSaveCollection: doubles.tauriCatalogSaveCollectionDouble,
    tauriCatalogReplaceWritingCollections: doubles.tauriCatalogReplaceWritingCollectionsDouble,
  })
})

vi.mock("@/lib/services/desktop/runtime-detection", async () =>
  (await import("../../support/editor-shell-doubles")).runtimeDetectionDouble())

vi.mock("@/lib/runtime/detect", async () =>
  (await import("../../support/editor-shell-doubles")).tauriRuntimeDetectDouble())

vi.mock("next/navigation", async () =>
  (await import("../../support/editor-shell-doubles")).nextNavigationDouble())

vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))

// Supabase sharing service: frontera externa real (red), fuera de la cadena
// declarada de WS-06. Se dobla para que el modal de preview pueda montarse
// (WorkspaceDetail lo importa aunque esté cerrado); no se ejerce ninguna acción.
vi.mock("@/lib/services/sharing-service-factory", () => ({
  createSharingService: () => ({
    getPreviewLink: async () => ({ data: { active: false, token: null, link: null, createdAt: null }, error: null }),
    rotatePreviewLink: async () => ({ data: null, error: null }),
    revokePreviewLink: async () => ({ data: null, error: null }),
  }),
}))

const { createDesktopDraft } = await import("@/lib/services/document-service-factory")
const { createAndAssignCollection } = await import("@/lib/queries/writing-mutations")
const { WorkspaceDetail } = await import("@/components/workspace/workspace-detail")
const { DesktopWorkspaceEntry } = await import("@/components/workspace/desktop-workspace-entry")
const { world } = await import("../../support/editor-shell-doubles")

type Runtime = "desktop" | "web"

let montage: TwoWorkspaceBase

beforeAll(() => {
  montage = configureTwoWorkspaceBase("odessay-workspace-isolation-")
  const w = globalThis as unknown as Record<string, unknown>
  if (typeof w.ResizeObserver !== "function") {
    w.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (typeof w.IntersectionObserver !== "function") {
    w.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
  }
  if (typeof w.matchMedia !== "function") {
    w.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })
  }
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  montage.dispose()
})

beforeEach(() => {
  resetCatalogDoubles()
  resetSettingsStoreDouble()
  world.isDesktop = true
  world.searchParams = new URLSearchParams("")
  world.navigations = []
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
  document.body.innerHTML = ""
})

/* ------------------------------------------------------------------ *
 * Montaje: fixtures reales de dos raíces
 * ------------------------------------------------------------------ */

type Fixtures = {
  rootA: string
  rootB: string
  idAlphaA: string
  idNotesA: string
  idBetaB: string
  idNotesB: string
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Dos Workspaces reales con BindingRoots registradas a la vez. Cada raíz
 * recibe dos documentos por la ruta de producción (crear borrador gestionado
 * → `assignToWorkspace`), incluido un homónimo `notes.md` en ambas. Las
 * colecciones se crean y asignan con `createAndAssignCollection` (la misma
 * función del flujo real de la vista).
 */
async function seedTwoWorkspaces(): Promise<Fixtures> {
  const { rootA, rootB, workspaceService } = await registerTwoWorkspaces(montage.baseDir, montage.configDir)

  const draft = async (title: string, text: string) => {
    const result = await createDesktopDraft({
      title,
      initialBodyJson: bodyJson(text),
      initialBodyText: text,
    })
    expect(result.error).toBeNull()
    return result.data!.id
  }

  // Interleaved create→move so each draft lands in its root before the next
  // "notes" is created in the managed root (otherwise the second one would
  // materialize as "notes 2.md" instead of the homonym this proof needs).
  const idAlphaA = await draft("alpha-a", "Alpha content in root A.")
  await workspaceService.assignToWorkspace(idAlphaA, "workspace-a")
  await wait(30)

  const idNotesA = await draft("notes", "Notes content in root A.")
  await workspaceService.assignToWorkspace(idNotesA, "workspace-a")
  await wait(30)

  const idBetaB = await draft("beta-b", "Beta content in root B.")
  await workspaceService.assignToWorkspace(idBetaB, "workspace-b")
  await wait(30)

  const idNotesB = await draft("notes", "Notes content in root B.")
  await workspaceService.assignToWorkspace(idNotesB, "workspace-b")

  await createAndAssignCollection(idAlphaA, "Letters A", null, [])
  await createAndAssignCollection(idBetaB, "Drafts B", null, [])

  return { rootA, rootB, idAlphaA, idNotesA, idBetaB, idNotesB }
}

/* ------------------------------------------------------------------ *
 * Harness de render (React DOM + act), sin tocar la lógica del producto
 * ------------------------------------------------------------------ */

type MountedView = {
  render: (node: ReactNode) => Promise<void>
  unmount: () => Promise<void>
}

let mounted: MountedView | null = null

async function mount(node: ReactNode): Promise<MountedView> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  const render = async (next: ReactNode) => {
    await act(async () => {
      root.render(next)
    })
    await flush()
  }
  await render(node)
  return {
    render,
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    },
  }
}

async function flush(times = 2) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function waitFor<T>(predicate: () => T | null | undefined | false, label: string, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = predicate()
    if (value) return value as T
    if (Date.now() > deadline) throw new Error(`waitFor agotó ${timeoutMs}ms esperando: ${label}`)
    await flush(3)
  }
}

/** Entrada real de cada runtime, con el slug como el producto lo navega. */
async function renderSlug(view: MountedView, runtime: Runtime, slug: string) {
  if (runtime === "desktop") {
    world.searchParams = new URLSearchParams(`slug=${slug}`)
    await view.render(createElement(DesktopWorkspaceEntry))
  } else {
    await view.render(createElement(WorkspaceDetail, { workspaceSlug: slug }))
  }
}

async function mountAt(runtime: Runtime, slug: string): Promise<MountedView> {
  if (runtime === "desktop") {
    world.searchParams = new URLSearchParams(`slug=${slug}`)
    return mount(createElement(DesktopWorkspaceEntry))
  }
  return mount(createElement(WorkspaceDetail, { workspaceSlug: slug }))
}

/* ------------------------------------------------------------------ *
 * Lecturas del DOM (estado canónico: lo que el usuario ve)
 * ------------------------------------------------------------------ */

const rowLabels = () =>
  [...document.querySelectorAll<HTMLElement>('[role="link"][aria-label^="Open "]')]
    .map((element) => element.getAttribute("aria-label")!)

const rowNames = () =>
  rowLabels().map((label) => label.replace(/^Open /, "").replace(/ in editor$/, ""))

const rowByFile = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="link"][aria-label^="Open "]')].find(
    (element) => element.getAttribute("aria-label") === `Open ${name} in editor`,
  ) ?? null

const headerTitle = () =>
  document.querySelector('[data-testid="workspace-detail-header"] h1')?.textContent?.trim() ?? null

const triggerText = (testId: string) => {
  const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? null
}

const hasText = (text: string) => document.body.textContent?.includes(text) ?? false

const emptyStateVisible = () => document.querySelector('[data-testid="desk-filter-empty"]') !== null

const selectionBarVisible = () => document.querySelector('[data-testid="desk-bulk-action-bar"]') !== null

function byTestId(testId: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (!element) throw new Error(`No existe [data-testid="${testId}"] en el DOM`)
  return element
}

function byText(selector: string, text: string): HTMLElement {
  const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
    (candidate) => candidate.textContent?.trim() === text,
  )
  if (!element) throw new Error(`No existe ${selector} con texto "${text}" en el DOM`)
  return element
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    element.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }))
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
  })
  await flush(2)
}

/**
 * Cambia el valor de un input como lo haría el usuario (setter nativo + evento
 * `input`), que es lo que React escucha para `onChange`.
 */
async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush(2)
}

const searchInput = () => document.querySelector<HTMLInputElement>('[data-testid="desk-filter-search"]')!

async function setSearch(value: string) {
  await typeInto(searchInput(), value)
  await flush(2)
}

async function applyCustomDateFrom(value: string) {
  await click(byTestId("desk-filter-trigger"))
  await click(byText("button", "Custom range"))
  const from = await waitFor(
    () => document.querySelector<HTMLInputElement>('input[aria-label="From"]'),
    "input From del rango custom",
  )
  await typeInto(from, value)
}

async function selectRow(name: string) {
  const button = [...document.querySelectorAll<HTMLElement>("button[aria-label]")].find(
    (candidate) => candidate.getAttribute("aria-label") === `Select ${name}`,
  )
  if (!button) throw new Error(`No existe el control de selección de ${name}`)
  await click(button)
}

const selectedToggleLabel = (name: string) =>
  document.querySelector<HTMLElement>(`button[aria-label="Deselect ${name}"]`) !== null

/* ------------------------------------------------------------------ *
 * Pruebas
 * ------------------------------------------------------------------ */

for (const runtime of ["desktop", "web"] as const) {
  describe(`WS-06 — Workspace switch isolation (${runtime})`, () => {
    it("positive control: the view state visibly changes what A shows", async () => {
      await seedTwoWorkspaces()
      const view = await mountAt(runtime, "workspace-a")
      mounted = view

      await waitFor(
        () => headerTitle() === "Workspace A" && rowNames().length === 2,
        "Workspace A cargado con sus dos documentos",
      )
      // Orden por defecto: más reciente primero (notes.md se creó después).
      expect(rowNames()).toEqual(["notes.md", "alpha-a.md"])

      // Filtro por nombre: se ve en la lista y en el contador del trigger.
      await setSearch("alpha")
      expect(rowNames()).toEqual(["alpha-a.md"])
      expect(triggerText("desk-filter-trigger")).toBe("Filter · 1")
      await setSearch("")
      await waitFor(() => rowNames().length === 2, "A vuelve a mostrar sus dos documentos")

      // Agrupación: se ve en el trigger y en la cabecera de grupo.
      await click(byTestId("desk-group-trigger"))
      await click(byText("button", "Status"))
      expect(triggerText("desk-group-trigger")).toBe("Group: Status")
      expect(hasText("Draft")).toBe(true)

      // Orden: se ve en el trigger y en el orden real de las filas.
      await click(byTestId("desk-sort-trigger"))
      await click(byText("button", "Oldest first"))
      expect(triggerText("desk-sort-trigger")).toBe("Sort: Oldest first")
      expect(rowNames()).toEqual(["alpha-a.md", "notes.md"])

      // Selección: la fila queda seleccionada y aparece la barra de acciones.
      await selectRow("alpha-a.md")
      expect(selectedToggleLabel("alpha-a.md")).toBe(true)
      expect(selectionBarVisible()).toBe(true)
      expect(hasText("1 selected")).toBe(true)

      // Filtro de fecha: vacía la vista de A (los documentos son de hoy).
      await applyCustomDateFrom("2099-01-01")
      await waitFor(() => emptyStateVisible(), "A filtrado por fecha no muestra resultados")
      expect(triggerText("desk-filter-trigger")).toBe("Filter · 1")
      expect(rowNames()).toEqual([])

      // Limpiar filtros devuelve A a su estado inicial de filtros; la
      // selección es estado aparte y sigue activa (comportamiento del código).
      await click(byTestId("desk-filter-clear-all"))
      await waitFor(() => rowNames().length === 2, "A vuelve tras Clear all")
      expect(triggerText("desk-filter-trigger")).toBe("Filter")
      expect(triggerText("desk-group-trigger")).toBe("Group by")
      expect(triggerText("desk-sort-trigger")).toBe("Sort: Newest first")
      expect(selectionBarVisible()).toBe(true)
      expect(selectedToggleLabel("alpha-a.md")).toBe(true)
    })

    // El aislamiento se prueba en los dos runtimes; en web la instancia de la
    // página sobrevive al cambio de slug y el estado de A se cuela en B — un
    // leak real (ODE-646). Esa mitad va `it.fails`: falla por esa razón y
    // quedará roja el día que se arregle, pidiendo invertirla.
    const isolationTest = runtime === "desktop" ? it : it.fails
    isolationTest("A view state does not appear in B, and returning to A matches the runtime contract", async () => {
      await seedTwoWorkspaces()
      const view = await mountAt(runtime, "workspace-a")
      mounted = view

      await waitFor(
        () => headerTitle() === "Workspace A" && rowNames().length === 2,
        "Workspace A cargado",
      )

      // Estado de vista completo en A (el control positivo de arriba prueba que
      // cada pieza se ve; aquí se aplican todas antes de cambiar de vista).
      await setSearch("alpha")
      await click(byTestId("desk-group-trigger"))
      await click(byText("button", "Status"))
      await click(byTestId("desk-sort-trigger"))
      await click(byText("button", "Oldest first"))
      await selectRow("alpha-a.md")
      await applyCustomDateFrom("2099-01-01")
      await waitFor(() => emptyStateVisible(), "A con filtro de fecha aplicado")
      expect(triggerText("desk-filter-trigger")).toBe("Filter · 2")
      expect(selectionBarVisible()).toBe(true)

      // La navegación real cambia de vista (misma URL/entrada que el producto).
      await renderSlug(view, runtime, "workspace-b")
      await waitFor(() => headerTitle() === "Workspace B", "Workspace B cargado")

      // Aislamiento: B muestra SUS documentos, sin nada del estado de A.
      expect(rowNames()).toEqual(["notes.md", "beta-b.md"])
      expect(emptyStateVisible()).toBe(false)
      expect(triggerText("desk-filter-trigger")).toBe("Filter")
      expect(triggerText("desk-group-trigger")).toBe("Group by")
      expect(triggerText("desk-sort-trigger")).toBe("Sort: Newest first")
      expect(selectionBarVisible()).toBe(false)
      expect(selectedToggleLabel("alpha-a.md")).toBe(false)
      expect(hasText("Letters A")).toBe(false)

      // Volver a A. Contrato por runtime (leído del código):
      // - desktop remonta por `key={workspaceSlug}` (desktop-workspace-entry.tsx:21),
      //   así que el estado de vista es nuevo y los datos de A siguen intactos.
      // - web conserva la instancia (la página no usa `key`); por eso las
      //   aserciones de aislamiento de arriba son `it.fails` en web (ODE-646).
      await renderSlug(view, runtime, "workspace-a")
      await waitFor(() => headerTitle() === "Workspace A", "Workspace A de vuelta")
      expect(rowNames()).toEqual(["notes.md", "alpha-a.md"])
      if (runtime === "desktop") {
        expect(triggerText("desk-filter-trigger")).toBe("Filter")
        expect(selectionBarVisible()).toBe(false)
      }
    })

    it("documents and collections of each root stay only in their own view", async () => {
      const fixtures = await seedTwoWorkspaces()
      const view = await mountAt(runtime, "workspace-a")
      mounted = view

      await waitFor(
        () => headerTitle() === "Workspace A" && rowNames().length === 2,
        "Workspace A cargado",
      )
      // La vista de A lista solo los documentos de A, con su colección.
      expect(rowNames()).toEqual(["notes.md", "alpha-a.md"])
      expect(rowByFile("alpha-a.md")?.textContent).toContain("Letters A")
      expect(rowByFile("notes.md")?.textContent).not.toContain("Letters A")
      expect(hasText("Drafts B")).toBe(false)

      // Búsqueda en A: su homónimo y lo suyo; nunca lo de B. Control positivo
      // (alpha aparece) antes de la ausencia (beta no aparece).
      await setSearch("alpha")
      expect(rowNames()).toEqual(["alpha-a.md"])
      await setSearch("beta")
      await waitFor(() => emptyStateVisible(), "β no existe en A")
      await setSearch("")
      await flush(2)

      await renderSlug(view, runtime, "workspace-b")
      await waitFor(
        () => headerTitle() === "Workspace B" && rowNames().length === 2,
        "Workspace B cargado",
      )
      // La vista de B lista solo los documentos de B: el homónimo es su propio
      // documento (su propio UUID) y no aparecen ni alpha-a ni su colección.
      expect(rowNames()).toEqual(["notes.md", "beta-b.md"])
      expect(rowByFile("beta-b.md")?.textContent).toContain("Drafts B")
      expect(rowByFile("notes.md")?.textContent).not.toContain("Drafts B")
      expect(hasText("Letters A")).toBe(false)

      await setSearch("beta")
      expect(rowNames()).toEqual(["beta-b.md"])
      await setSearch("alpha")
      await waitFor(() => emptyStateVisible(), "α no existe en B")
      await setSearch("")
      await flush(2)

      // Volver a A: sus documentos y su colección siguen ahí.
      await renderSlug(view, runtime, "workspace-a")
      await waitFor(
        () => headerTitle() === "Workspace A" && rowNames().length === 2,
        "Workspace A de vuelta",
      )
      expect(rowNames()).toEqual(["notes.md", "alpha-a.md"])
      expect(rowByFile("alpha-a.md")?.textContent).toContain("Letters A")
      expect(hasText("Drafts B")).toBe(false)

      // Los UUID del homónimo son distintos por raíz (mismo nombre, otro
      // documento): cada vista muestra el que le corresponde.
      expect(fixtures.idNotesA).not.toBe(fixtures.idNotesB)
    })
  })
}
