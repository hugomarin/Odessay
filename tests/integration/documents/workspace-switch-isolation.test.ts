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
 *     whose only job is to render `<WorkspaceDetail workspaceSlug={slug} />`.
 *     A server component cannot be rendered by `createRoot`, so the test
 *     renders the same element the page renders — **with the React `key` the
 *     App Router puts on that segment**. That key is what makes a real
 *     `/workspace/a → /workspace/b` navigation remount the page (human
 *     decision of 2026-09-30, after the ciclo-1 review corrected the earlier
 *     "sin key → la instancia sobrevive" premise): the router renders each
 *     segment with `key={stateKey}`
 *     (`node_modules/next/dist/client/components/layout-router.js:510`),
 *     where `stateKey = createRouterCacheKey(activeSegment, true)`
 *     (`layout-router.js:402-410`); for the dynamic segment `[slug]` that
 *     value is `"slug|<value>|d"` (`node_modules/next/dist/client/components/
 *     router-reducer/create-router-cache-key.js:12-20`).
 *     The router's own comment (`layout-router.js:398-400`): "Whenever the
 *     state key changes, the tree is recreated and the state is reset." What
 *     is lost by not entering through the Next.js router itself is the RSC
 *     plumbing; the client component's lifetime, its effects and its state
 *     are the ones under test. The control mutation for this half removes the
 *     key and the isolation assertions go red (`expected [] to deeply equal
 *     [ 'notes.md', 'beta-b.md' ]`), proving the test would detect a leak if
 *     the product did not remount.
 *
 * - **Transition sequence (rule 2).** Two real, distinct temp directories are
 *   registered as the real production shape (a `WorkspaceRecord` + a
 *   `BindingRoot` each). Each root gets documents through production's own
 *   path (`createDesktopDraft` → `DesktopWorkspaceService.assignToWorkspace`)
 *   and collections through `createAndAssignCollection` — the same function
 *   the view's own "create collection" action calls. Both roots hold a
 *   document with the same filename (`notes.md`, different UUIDs), and each
 *   homonym carries its own collection (`Notes A` / `Notes B`) so a
 *   relative-path identity confusion is visible in the rendered DOM.
 *
 * - **Real seams (rule 3).** `WorkspaceDetail`, `DesktopWorkspaceEntry`, the
 *   real services, the real in-memory catalog/manifest/collection doubles of
 *   `support/real-desktop-doubles.ts` — only the Tauri IPC transport (and the
 *   Supabase flush, a genuinely external boundary) are doubled. Opening the
 *   homonym row runs the real unified opener (`openWorkspaceFileInEditor` →
 *   `openDocumentByPath`) and asserts the navigation id it resolves.
 *
 * - **Completion event (rule 4).** `loadWorkspace` resolving for the new slug:
 *   the assertions wait for the header and the rows of B, never for the
 *   navigation click. The Req. 4 proof waits for the persistence coordinator's
 *   `settle()` — the save's own durability event — before reading disk/catalog.
 *
 * - **Canonical outcome (rule 6).** Rendered DOM: visible rows, filter/group/
 *   sort trigger labels, collection chips, selection bar. For Req. 4: the real
 *   temporary filesystem and the catalog rows themselves.
 *
 * - **Positive control first (rule 8).** A sibling test proves each piece of
 *   view state visibly changes A; the isolation tests assert an absence only
 *   after that control, and the homonym chips are asserted for each root
 *   before their cross-root absence.
 */
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import {
  resetCatalogDoubles,
  resetSettingsStoreDouble,
  tauriCatalogListDouble,
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
    // Extensión para el modo de fallo stale-listener (F6): el cambio de
    // metadatos real (`changeWritingStatus`) escribe el catálogo con la forma
    // bulk, que el montaje base deja como stub ruidoso.
    tauriCatalogBulkDualWrite: doubles.tauriCatalogBulkDualWriteDouble,
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

const { createDesktopDraft, getDocumentService } = await import("@/lib/services/document-service-factory")
const { createAndAssignCollection, changeWritingStatus } = await import("@/lib/queries/writing-mutations")
const { createPersistenceCoordinator } = await import("@/lib/editor/persistence-coordinator")
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

type DraftRecord = NonNullable<Awaited<ReturnType<typeof createDesktopDraft>>["data"]>

type Fixtures = {
  rootA: string
  rootB: string
  idAlphaA: string
  idNotesA: string
  idBetaB: string
  idNotesB: string
  /** Record completo del homónimo de B, para el save real del Req. 4. */
  recordNotesB: DraftRecord
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Dos Workspaces reales con BindingRoots registradas a la vez. Cada raíz
 * recibe dos documentos por la ruta de producción (crear borrador gestionado
 * → `assignToWorkspace`), incluido un homónimo `notes.md` en ambas. Las
 * colecciones se crean y asignan con `createAndAssignCollection` (la misma
 * función del flujo real de la vista); los homónimos llevan cada uno su
 * propia colección para que una confusión de identidad por ruta relativa sea
 * visible en el DOM (chip de la otra raíz) y no solo en el id.
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
    return result.data!
  }

  // Interleaved create→move so each draft lands in its root before the next
  // "notes" is created in the managed root (otherwise the second one would
  // materialize as "notes 2.md" instead of the homonym this proof needs).
  const recordAlphaA = await draft("alpha-a", "Alpha content in root A.")
  await workspaceService.assignToWorkspace(recordAlphaA.id, "workspace-a")
  await wait(30)

  const recordNotesA = await draft("notes", "Notes content in root A.")
  await workspaceService.assignToWorkspace(recordNotesA.id, "workspace-a")
  await wait(30)

  const recordBetaB = await draft("beta-b", "Beta content in root B.")
  await workspaceService.assignToWorkspace(recordBetaB.id, "workspace-b")
  await wait(30)

  const recordNotesB = await draft("notes", "Notes content in root B.")
  await workspaceService.assignToWorkspace(recordNotesB.id, "workspace-b")

  await createAndAssignCollection(recordAlphaA.id, "Letters A", null, [])
  await createAndAssignCollection(recordBetaB.id, "Drafts B", null, [])
  await createAndAssignCollection(recordNotesA.id, "Notes A", null, [])
  await createAndAssignCollection(recordNotesB.id, "Notes B", null, [])

  return {
    rootA,
    rootB,
    idAlphaA: recordAlphaA.id,
    idNotesA: recordNotesA.id,
    idBetaB: recordBetaB.id,
    idNotesB: recordNotesB.id,
    recordNotesB,
  }
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

/**
 * Por debajo del timeout de vitest (5000 ms) para que un rojo por condición
 * nombre la condición, no `Test timed out` (hallazgo F5 del review de ciclo 1).
 */
async function waitFor<T>(predicate: () => T | null | undefined | false, label: string, timeoutMs = 4000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = predicate()
    if (value) return value as T
    if (Date.now() > deadline) throw new Error(`waitFor agotó ${timeoutMs}ms esperando: ${label}`)
    await flush(3)
  }
}

/**
 * La `key` que el App Router de Next pone al subárbol del segmento dinámico
 * `[slug]`: `layout-router.js:510` renderiza cada segmento con `key={stateKey}`
 * y `stateKey = createRouterCacheKey(activeSegment, true)`
 * (`layout-router.js:402-410`). Para un segmento dinámico
 * (`["slug", "<valor>", "d"]`) `createRouterCacheKey` devuelve
 * `"slug|<valor>|d"` (`router-reducer/create-router-cache-key.js:12-20`).
 * El comentario del propio router (`layout-router.js:398-400`): "Whenever the
 * state key changes, the tree is recreated and the state is reset." Reproducir
 * esa key es lo que hace que la entrada web remonte al cambiar de slug, como
 * el producto real (decisión del humano 2026-09-30).
 */
const webSegmentStateKey = (slug: string) => `slug|${slug}|d`

/** Entrada real de cada runtime, con el slug como el producto lo navega. */
async function renderSlug(view: MountedView, runtime: Runtime, slug: string) {
  if (runtime === "desktop") {
    world.searchParams = new URLSearchParams(`slug=${slug}`)
    await view.render(createElement(DesktopWorkspaceEntry))
  } else {
    await view.render(createElement(WorkspaceDetail, { key: webSegmentStateKey(slug), workspaceSlug: slug }))
  }
}

async function mountAt(runtime: Runtime, slug: string): Promise<MountedView> {
  if (runtime === "desktop") {
    world.searchParams = new URLSearchParams(`slug=${slug}`)
    return mount(createElement(DesktopWorkspaceEntry))
  }
  return mount(createElement(WorkspaceDetail, { key: webSegmentStateKey(slug), workspaceSlug: slug }))
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
 * Abre una fila por el opener unificado real (`openWorkspaceFileInEditor` →
 * `openDocumentByPath`) y devuelve el UUID al que navegó, leído de
 * `world.navigations`. Es el evento de apertura canónico del producto:
 * `router.push("/write?id=<uuid>")`.
 */
async function openRowAndResolveId(name: string): Promise<string> {
  const row = rowByFile(name)
  if (!row) throw new Error(`No existe la fila abrible ${name}`)
  const before = world.navigations.length
  await click(row)
  const nav = await waitFor(
    () =>
      world.navigations
        .slice(before)
        .find((entry) => entry.kind === "push" && entry.href.startsWith("/write?id=")) ?? null,
    `navegación /write?id= al abrir ${name}`,
  )
  return decodeURIComponent(nav.href.slice("/write?id=".length))
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

    // El aislamiento se prueba en los dos runtimes con la misma exigencia: la
    // entrada web reproduce el remontaje real del App Router con la state key
    // del segmento `[slug]` (ver `webSegmentStateKey`), y la mitad desktop
    // remonta por `key={workspaceSlug}`. Con la mutación de control (quitar
    // esa key en la entrada web) esta prueba se pone roja, así que detecta una
    // fuga si el producto dejara de remontar.
    it("A view state does not appear in B, and returning to A matches the runtime contract", async () => {
      const fixtures = await seedTwoWorkspaces()
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

      // Modo de fallo del brief: un listener de la raíz A que siga activo
      // después del cambio no debe recargar ni pisar B. Se disparan las dos
      // señales que la vista escucha — focus (workspace-detail.tsx:326-330) y
      // cambios del catálogo con debounce de 100 ms (:332-349) — y B sigue
      // siendo B. Control positivo del listener de catálogo: el cambio de
      // metadatos real de B sí llega a la vista recargada (status "Done").
      window.dispatchEvent(new Event("focus"))
      await changeWritingStatus(fixtures.idBetaB, "done")
      await waitFor(
        () => rowByFile("beta-b.md")?.textContent?.includes("Done") ?? false,
        "B recarga tras el cambio de catálogo",
      )
      expect(headerTitle()).toBe("Workspace B")
      expect(rowNames()).toEqual(["notes.md", "beta-b.md"])
      expect(triggerText("desk-filter-trigger")).toBe("Filter")
      expect(emptyStateVisible()).toBe(false)

      // Volver a A. Contrato único de los dos runtimes: la entrada remonta
      // (desktop por `key={workspaceSlug}`, desktop-workspace-entry.tsx:21;
      // web por la state key del segmento `[slug]` del App Router), así que el
      // estado de vista arranca limpio y los datos de A siguen intactos.
      await renderSlug(view, runtime, "workspace-a")
      await waitFor(() => headerTitle() === "Workspace A", "Workspace A de vuelta")
      expect(rowNames()).toEqual(["notes.md", "alpha-a.md"])
      expect(triggerText("desk-filter-trigger")).toBe("Filter")
      expect(selectionBarVisible()).toBe(false)
    })

    it("documents and collections of each root stay only in their own view, and the homonym opens its own document", async () => {
      const fixtures = await seedTwoWorkspaces()
      const view = await mountAt(runtime, "workspace-a")
      mounted = view

      await waitFor(
        () => headerTitle() === "Workspace A" && rowNames().length === 2,
        "Workspace A cargado",
      )
      // La vista de A lista solo los documentos de A, con su colección; el
      // homónimo lleva la suya ("Notes A") y no la de B (control positivo
      // por documento: el chip correcto aparece antes de afirmar el ausente).
      expect(rowNames()).toEqual(["notes.md", "alpha-a.md"])
      expect(rowByFile("alpha-a.md")?.textContent).toContain("Letters A")
      expect(rowByFile("notes.md")?.textContent).toContain("Notes A")
      expect(rowByFile("notes.md")?.textContent).not.toContain("Notes B")
      expect(hasText("Drafts B")).toBe(false)

      // El homónimo de A abre SU documento por el opener unificado real, y
      // ese UUID reabre su propio contenido (mismo nombre de archivo, otra
      // raíz, otro documento).
      const service = await getDocumentService()
      const openedIdA = await openRowAndResolveId("notes.md")
      expect(openedIdA).toBe(fixtures.idNotesA)
      const openedA = await service.openWriting(fixtures.idNotesA)
      expect(openedA.data!.content.plainText).toContain("Notes content in root A.")

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
      // documento (su propio UUID y su propia colección) y no aparecen ni
      // alpha-a ni su colección.
      expect(rowNames()).toEqual(["notes.md", "beta-b.md"])
      expect(rowByFile("beta-b.md")?.textContent).toContain("Drafts B")
      expect(rowByFile("notes.md")?.textContent).toContain("Notes B")
      expect(rowByFile("notes.md")?.textContent).not.toContain("Notes A")
      expect(hasText("Letters A")).toBe(false)

      // El homónimo de B abre SU documento, no el de A.
      const openedIdB = await openRowAndResolveId("notes.md")
      expect(openedIdB).toBe(fixtures.idNotesB)
      const openedB = await service.openWriting(fixtures.idNotesB)
      expect(openedB.data!.content.plainText).toContain("Notes content in root B.")

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
      expect(rowByFile("notes.md")?.textContent).toContain("Notes A")
      expect(rowByFile("notes.md")?.textContent).not.toContain("Notes B")
      expect(hasText("Drafts B")).toBe(false)
    })
  })
}

/* ------------------------------------------------------------------ *
 * Requirement 4 — escribir en B no toca archivos ni filas de A
 * ------------------------------------------------------------------ */

/** Snapshot de guardado con la forma que consume `PersistenceCoordinator`. */
function snapshotFor(record: DraftRecord, text: string) {
  return {
    writingId: record.id,
    createdAt: record.createdAt,
    version: record.version,
    title: record.title ?? "Untitled",
    bodyJson: bodyJson(text),
    bodyText: text,
    status: record.status,
    artifactType: record.artifactType,
    visibility: record.visibility,
    lifecycle: "local-only" as const,
  }
}

/**
 * WS-06 · Req. 4 — un guardado real en B (la ruta de producción de DOC-03:
 * `PersistenceCoordinator.persist` → `DesktopDocumentService.saveWriting` →
 * `.md` + manifiesto + catálogo) no toca ni los archivos ni las filas de A.
 * El evento de completitud es `settle()`, no `persist()` (regla 4): recién ahí
 * el guardado es durable. Antes/después se leen el fs temporal real, el
 * listado del directorio de A y las filas del catálogo de cada documento de A
 * (id, ruta canónica, ruta relativa, binding y content hash).
 */
describe("WS-06 — writing in B leaves A's files and catalog rows untouched", () => {
  it("a real save in B updates B's document and leaves A byte-identical", async () => {
    const fixtures = await seedTwoWorkspaces()
    const dbPath = join(montage.configDir, "desktop-index.sqlite3")

    const rootARows = async () =>
      (await tauriCatalogListDouble(dbPath))
        .filter((row) => row.canonicalPath?.startsWith(`${fixtures.rootA}/`))
        .map((row) => ({
          id: row.id,
          bindingRootId: row.bindingRootId,
          relativePath: row.relativePath,
          canonicalPath: row.canonicalPath,
          contentHash: row.contentHash,
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    const rowFor = async (id: string) => {
      const row = (await tauriCatalogListDouble(dbPath)).find((candidate) => candidate.id === id)
      if (!row) throw new Error(`No existe la fila ${id} en el catálogo`)
      return row
    }

    // Estado canónico de A antes del guardado: filas, archivos y listado real.
    const beforeARows = await rootARows()
    expect(beforeARows.map((row) => row.id).sort()).toEqual([fixtures.idAlphaA, fixtures.idNotesA].sort())
    const beforeAFiles = new Map<string, string>()
    for (const row of beforeARows) {
      beforeAFiles.set(row.id, await readFile(row.canonicalPath!, "utf8"))
    }
    expect(beforeAFiles.get(fixtures.idNotesA)).toContain("Notes content in root A.")
    const beforeADir = (await readdir(fixtures.rootA)).sort()
    const beforeNotesBRow = await rowFor(fixtures.idNotesB)
    const beforeNotesBHash = beforeNotesBRow.contentHash

    // Guardado real en B por la ruta de producción (DOC-03).
    const service = await getDocumentService()
    const coordinator = createPersistenceCoordinator({
      runtime: "desktop",
      persistenceDebounceMs: 0,
      documentService: service,
      createWritingId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    })
    coordinator.persist(snapshotFor(fixtures.recordNotesB, "Edited while working in workspace B."))
    await coordinator.settle({ writingId: fixtures.idNotesB })

    // B sí cambió: su archivo y su fila reflejan el guardado (control
    // positivo de que el write ocurrió de verdad).
    const afterNotesBRow = await rowFor(fixtures.idNotesB)
    const notesBOnDisk = await readFile(afterNotesBRow.canonicalPath!, "utf8")
    expect(notesBOnDisk).toContain("Edited while working in workspace B.")
    expect(afterNotesBRow.contentHash).not.toBe(beforeNotesBHash)

    // A no se tocó: ni filas de catálogo (id, rutas, binding, hash), ni
    // archivos (contenido byte a byte), ni el listado del directorio.
    expect(await rootARows()).toEqual(beforeARows)
    for (const row of beforeARows) {
      expect(await readFile(row.canonicalPath!, "utf8")).toBe(beforeAFiles.get(row.id))
    }
    expect((await readdir(fixtures.rootA)).sort()).toEqual(beforeADir)
  })
})
