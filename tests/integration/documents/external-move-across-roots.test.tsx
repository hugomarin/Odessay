/**
 * @vitest-environment happy-dom
 *
 * ODE-657 — WATCH-04: un archivo movido **fuera de la app** (Finder) desde una
 * raíz vigilada A a otra raíz vigilada B conserva su UUID, su binding apunta a
 * B y la shell avisa "moved", no "removed".
 *
 * Proof Contract (workflow/quality/capability-proof-contract.md):
 *
 * - **Entry point (regla 1).** La cadena real del watcher: `renameSync` sobre
 *   disco real → evento nativo `plugin:fs|watch` (`emitFsWatchEvent`, dobla el
 *   transporte del SO) → supresión de auto-escrituras real →
 *   `WorkspaceReconciler` real (singleton de `desktop-workspace-reconciler.ts`)
 *   → `workspace_sync` real (el doble opera sobre el fs temporal) →
 *   `correlateAcrossRoots` → `catalog_apply_reconcile` (doble espejo del SQL) →
 *   `CatalogChange` → shell montada.
 * - **Transición real (regla 2).** Las dos raíces se registran con la forma de
 *   producción (`DesktopWorkspaceService.addExistingWorkspace`, no ids
 *   sintéticos ni modo api) y el documento se abre por el menú nativo con el
 *   opener unificado real; el movimiento es un `renameSync` real, no un estado
 *   sembrado.
 * - **Seams internos reales (regla 3).** `tauri-commands` NO está mockeado: el
 *   `invoke` del router dobla solo el transporte Tauri. Catálogo, manifest,
 *   settings y watcher corren sobre los dobles reales de fs.
 * - **Completion event (regla 4).** El binding durable en el catálogo (y el
 *   aviso de la shell), nunca "se llamó a workspace_sync".
 * - **Resultado canónico (regla 6).** Disco real + filas del catálogo + DOM de
 *   la shell.
 * - **Control positivo (regla 8).** Un movimiento dentro de una sola raíz
 *   (donde la correlación por inode ya existe) prueba que el montaje detecta
 *   "moved" y conserva el UUID; sin él, el rojo de los dos órdenes de raíz
 *   podría ser un fallo del harness.
 * - **Dos órdenes (Req. 1).** A→B notificando A primero y B primero, cada uno
 *   con dos eventos separados dentro de la misma ráfaga (<250 ms): el coalesce
 *   del reconciler junta las dos raíces en una sola pasada.
 * - **Mutación del modo de fallo (BUILD).** Con el código previo al fix, los
 *   dos casos A→B quedan rojos por la razón declarada (UUID nuevo en B +
 *   aviso "deleted" en A) y el control sigue verde.
 *
 * Fuera de alcance declarado (brief): movimientos entre volúmenes (el inode no
 * es comparable). La separación temporal entre avisos dejó de ser límite de
 * producto en ODE-661: los dos órdenes con 500 ms viven en este archivo.
 *
 * Extensión ODE-615 — variantes de la prueba (el fix es de ODE-657):
 *
 * - **Carpeta no registrada.** Política documentada: "detach local y rebind
 *   futuro por hash u Open Document" (`odessay-desktop-document-catalog.md:519`),
 *   no "no encontrado". Se espera verde: mismo UUID, `local_present=0`, sin
 *   binding huérfano, sin fila nueva y aviso de la shell del kind `deleted`
 *   (`hooks/useExternalDocumentChanges.ts:169-173`) — se afirma el
 *   discriminante tipado en la salida del owner real (el objeto
 *   `{ kind, path }` que el hook entrega), nunca el texto "removed" suelto.
 * - **Dos ráfagas separadas (500 ms, ODE-661).** Decisión de Hugo
 *   (2026-10-03): sin máximo temporal entre avisos. Una pasada que ve solo un
 *   lado de un movimiento posible (un archivo no ligado o un binding
 *   confirmado ausente, sin su par) expande esa misma pasada a todas las
 *   raíces activas antes de acuñar un UUID o confirmar el detach. Los dos
 *   órdenes de raíz con `advance(500)` quedan abajo; los dos órdenes dentro de
 *   una misma ráfaga (<250 ms) los cubre este archivo arriba (ODE-657), y el
 *   coste del barrido (edición normal local vs. expansión única) se afirma en
 *   el último bloque del archivo.
 */
import { mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { ExternalFileNotice } from "@/hooks/useExternalDocumentChanges"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("../../support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
/**
 * Observa la salida tipada del owner real del aviso (`useExternalDocumentChanges`),
 * sin sustituirlo: el hook corre entero y el wrapper solo registra el valor
 * (`{ kind, path }`) que le entrega a la shell. `emit` es estable a propósito:
 * el efecto del hook lo lleva en sus dependencias y una función nueva por
 * render lo haría reejecutar en bucle.
 */
const externalNoticeObserver = vi.hoisted(() => {
  const notices: ExternalFileNotice[] = []
  let latest: ((notice: ExternalFileNotice | null) => void) | null = null
  return {
    notices,
    connect(setter: (notice: ExternalFileNotice | null) => void) {
      latest = setter
    },
    emit(notice: ExternalFileNotice | null) {
      if (notice) notices.push(notice)
      latest?.(notice)
    },
  }
})
vi.mock("@/hooks/useExternalDocumentChanges", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useExternalDocumentChanges")>()
  return {
    ...actual,
    useExternalDocumentChanges: (input: Parameters<typeof actual.useExternalDocumentChanges>[0]) => {
      externalNoticeObserver.connect(input.setExternalFileNotice)
      return actual.useExternalDocumentChanges({
        ...input,
        setExternalFileNotice: externalNoticeObserver.emit,
      })
    },
  }
})
vi.mock("next/navigation", async () =>
  (await import("../../support/editor-shell-doubles")).nextNavigationDouble(),
)
vi.mock("@tauri-apps/api/core", async (importOriginal) =>
  (await import("../../support/editor-shell-doubles")).tauriCoreDouble(
    await importOriginal<Record<string, unknown>>(),
  ),
)
vi.mock("@tauri-apps/api/event", async () =>
  (await import("../../support/editor-shell-doubles")).tauriEventDouble(),
)
vi.mock("@tauri-apps/api/window", async () =>
  (await import("../../support/editor-shell-doubles")).tauriWindowDouble(),
)
vi.mock("@tauri-apps/plugin-dialog", async () =>
  (await import("../../support/editor-shell-doubles")).tauriDialogDouble(),
)
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => {}) }))
vi.mock("@/lib/services/desktop/runtime-detection", async () =>
  (await import("../../support/editor-shell-doubles")).runtimeDetectionDouble(),
)
vi.mock("@/lib/services/ai-service-factory", async () =>
  (await import("../../support/editor-shell-doubles")).aiServiceDouble(),
)
vi.mock("@tauri-apps/api/path", async () =>
  (await import("../../support/editor-shell-desktop-doubles")).tauriPathDouble(),
)
vi.mock("@/lib/sync/sync-service-factory", async () =>
  (await import("../../support/editor-shell-desktop-doubles")).syncServiceDouble(),
)
// Intentionally no mock for `@/lib/services/desktop/tauri-commands`: the real
// wrapper (mintUnbound, bindUnbound, id mapping) is part of the chain under test.

const {
  advance,
  assertNoUnhandledErrors,
  emitFsWatchEvent,
  emitTauriEvent,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  waitFor,
} = await import("../../support/editor-shell-harness")
const { tauriInvokeRouterDouble, world } = await import("../../support/editor-shell-doubles")
const {
  createDesktopWorkspace,
  desktopWorkspaceRoot,
  destroyDesktopWorkspace,
  resetDesktopWorkspace,
  tauriCommandsDouble,
} = await import("../../support/editor-shell-desktop-doubles")
const { tauriWorkspaceSyncInvokeDouble } = await import("./support/real-desktop-doubles")
const { getDesktopWorkspaceService } = await import("@/lib/services/desktop/workspace-service")
const { clearOdessaySelfWritePathsForTests } = await import("@/lib/services/desktop/tauri-fs-watch")
const { disposeWorkspaceReconciler, ensureWorkspaceReconciler } = await import(
  "@/lib/services/desktop/desktop-workspace-reconciler"
)
import type {
  KnownBinding,
  ObservedFile,
  ReconcileCommit,
  ReconcilerRoot,
  UnboundFile,
} from "@/lib/services/desktop/workspace-reconciler"
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { createWorkspaceReconciler } = await import(
  "@/lib/services/desktop/workspace-reconciler"
)
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")

const TEST_TIMEOUT_MS = 60_000
const MOVED_NOTICE = "This file moved outside Artifact Studio"
const DELETED_NOTICE = "This file was removed outside Artifact Studio"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let alerts: string[] = []

beforeAll(() => {
  createDesktopWorkspace("odessay-watch04-cross-root-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  clearOdessaySelfWritePathsForTests()
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "harness-anon-key")
  world.tauriInvoke = tauriInvokeRouterDouble({
    ...tauriCommandsDouble({ withReconciler: true }),
    tauriWorkspaceSync: tauriWorkspaceSyncInvokeDouble,
  })
  vi.spyOn(window, "confirm").mockReturnValue(true)
  alerts = []
  externalNoticeObserver.notices.length = 0
  window.alert = (message?: unknown) => {
    alerts.push(String(message))
  }
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
  await disposeWorkspaceReconciler()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function makeRoot(name: string) {
  const folder = join(desktopWorkspaceRoot(), name)
  mkdirSync(folder, { recursive: true })
  return folder
}

function writeMarkdownIn(root: string, title: string, body: string) {
  const path = join(root, `${title}.md`)
  writeFileSync(path, `${body}\n`)
  return path
}

function editorText() {
  return mounted!.editor().getText()
}

function bannerText() {
  return mounted!.container.textContent ?? ""
}

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id) ?? null
}

async function registerWorkspace(rootPath: string) {
  world.openDialogResult = rootPath
  const service = await getDesktopWorkspaceService()
  const workspace = await service.addExistingWorkspace()
  if (!workspace) throw new Error(`No se registró la raíz ${rootPath}`)
  return workspace.rootPath
}

async function startReconciler() {
  await ensureWorkspaceReconciler()
  await advance(100)
}

async function mountLoaded() {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
}

async function openFromNativeMenu(path: string, body: string) {
  world.openDialogResult = path
  await emitTauriEvent("menu:open-file")
  await flush(5)
  await waitFor(() => editorText().includes(body), {
    label: `documento abierto: ${body}`,
    timeoutMs: 15_000,
  })
  if (alerts.length > 0) throw new Error(`El opener no abrió ${path}: ${alerts.join(" | ")}`)
  await advance(50)
  const writingId = activeTab()?.writing_id
  if (!writingId) throw new Error(`${path} abrió sin identidad`)
  return writingId
}

async function waitForWatcherOn(rootPath: string) {
  await waitFor(
    () =>
      world.fsWatchers.some(
        (watcher) =>
          !watcher.closed &&
          watcher.paths.some((path) => rootPath.startsWith(path) || path.startsWith(rootPath)),
      ),
    { label: `watcher nativo sobre ${rootPath}`, timeoutMs: 10_000 },
  )
  await advance(100)
}

async function waitForCatalogBindingAt(path: string) {
  const catalog = await getDocumentCatalog()
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const resolution = await catalog.resolvePath(path)
    if (resolution.kind === "resolved") return resolution.record
    await advance(100)
  }
  throw new Error(`El catálogo no resolvió ${path}`)
}

type ScanCall = { rootPath: string; files: number }

/**
 * Cuenta pasadas y archivos inspeccionados por `scanRoot` del reconciler real.
 * Instrumenta el transporte Tauri (boundary externo ya doblado): cada scan
 * emite exactamente un `workspace_sync` con `mintUnbound:false`, así que contar
 * `workspace_sync` por `rootPath` mide el coste del barrido sin tocar el owner.
 */
function countWorkspaceSyncScans(): ScanCall[] {
  const scans: ScanCall[] = []
  const inner = world.tauriInvoke
  world.tauriInvoke = async (command, args) => {
    const result = await inner(command, args)
    if (command === "workspace_sync") {
      const snapshot = result as { files?: unknown[]; unboundFiles?: unknown[] }
      scans.push({
        rootPath: typeof args?.rootPath === "string" ? args.rootPath : "",
        files: (snapshot.files?.length ?? 0) + (snapshot.unboundFiles?.length ?? 0),
      })
    }
    return result
  }
  return scans
}

/**
 * Prefijo de scans de la primera pasada de una ráfaga: corta en la primera
 * raíz repetida. Una pasada correcta escanea cada raíz activa como máximo una
 * vez; los bursts posteriores (p. ej. el disparado por la escritura del
 * manifest del destino) pueden volver a escanear una raíz ya vista y quedan
 * fuera de la medición.
 */
function firstPassScans(scans: ScanCall[]): ScanCall[] {
  const pass: ScanCall[] = []
  const seen = new Set<string>()
  for (const scan of scans) {
    if (seen.has(scan.rootPath)) break
    seen.add(scan.rootPath)
    pass.push(scan)
  }
  return pass
}

describe("ODE-657 — movimiento externo entre dos raíces vigiladas (WATCH-04)", () => {
  it(
    "conserva el UUID de A en B cuando el watcher notifica A primero",
    async () => {
      const rootA = makeRoot("Raiz A")
      const rootB = makeRoot("Raiz B")
      const pathA = writeMarkdownIn(rootA, "Carta cruzada", "ODE657 cuerpo cruzado.")
      // Un vecino residente mantiene conocido el volumen de A tras el
      // movimiento: la correlación exige el mismo dispositivo en ambos lados,
      // y una raíz sin evidencia de archivos queda "volumen desconocido"
      // (review ronda 1, P1).
      writeMarkdownIn(rootA, "Vecino de A", "ODÉ657 residente de la raíz A.")
      await registerWorkspace(rootA)
      await registerWorkspace(rootB)
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(pathA, "ODE657 cuerpo cruzado.")
      await waitForWatcherOn(rootA)
      await waitForWatcherOn(rootB)

      const pathB = join(rootB, "Carta cruzada.md")
      renameSync(pathA, pathB)
      // Dos eventos separados dentro de la ráfaga (<250 ms): fijan el orden de
      // notificación A→B, que un solo evento con ambas rutas no controla.
      await emitFsWatchEvent([pathA])
      await emitFsWatchEvent([pathB])
      await advance(500)

      await waitFor(() => bannerText().includes(MOVED_NOTICE), {
        label: "la shell avisa 'moved' tras el movimiento entre raíces",
        timeoutMs: 15_000,
      })
      expect(bannerText()).not.toContain(DELETED_NOTICE)
      expect(bannerText()).toContain(pathB)
      expect(activeTab()?.writing_id, "misma identidad en la pestaña").toBe(writingId)

      const catalog = await getDocumentCatalog()
      const record = await waitForCatalogBindingAt(pathB)
      expect(record.id, "el UUID de A sobrevive en B").toBe(writingId)
      expect(record.localPresent).toBe(true)
      expect(record.binding?.canonicalPath).toBe(pathB)
      expect((await catalog.resolvePath(pathA)).kind, "la ruta vieja ya no resuelve").toBe("unbound")
      const byId = await catalog.getById(writingId)
      expect(byId?.binding?.canonicalPath).toBe(pathB)
      const boundToPath = (await catalog.list()).filter(
        (row) => row.binding?.canonicalPath === pathB,
      )
      expect(boundToPath.map((row) => row.id), "sin fila duplicada en B").toEqual([writingId])
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "conserva el UUID de A en B cuando el watcher notifica B primero",
    async () => {
      const rootA = makeRoot("Raiz A")
      const rootB = makeRoot("Raiz B")
      const pathA = writeMarkdownIn(rootA, "Carta cruzada", "ODE657 cuerpo cruzado inverso.")
      writeMarkdownIn(rootA, "Vecino de A", "ODÉ657 residente de la raíz A.")
      await registerWorkspace(rootA)
      await registerWorkspace(rootB)
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(pathA, "ODE657 cuerpo cruzado inverso.")
      await waitForWatcherOn(rootA)
      await waitForWatcherOn(rootB)

      const pathB = join(rootB, "Carta cruzada.md")
      renameSync(pathA, pathB)
      await emitFsWatchEvent([pathB])
      await emitFsWatchEvent([pathA])
      await advance(500)

      await waitFor(() => bannerText().includes(MOVED_NOTICE), {
        label: "la shell avisa 'moved' con el orden B→A",
        timeoutMs: 15_000,
      })
      expect(bannerText()).not.toContain(DELETED_NOTICE)
      expect(activeTab()?.writing_id, "misma identidad en la pestaña").toBe(writingId)

      const catalog = await getDocumentCatalog()
      const record = await waitForCatalogBindingAt(pathB)
      expect(record.id, "el UUID de A sobrevive en B").toBe(writingId)
      expect(record.localPresent).toBe(true)
      expect((await catalog.resolvePath(pathA)).kind, "la ruta vieja ya no resuelve").toBe("unbound")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "control positivo: un movimiento dentro de una sola raíz conserva el UUID",
    async () => {
      const rootA = makeRoot("Raiz control")
      const pathA = writeMarkdownIn(rootA, "Carta interna", "ODE657 cuerpo interno.")
      await registerWorkspace(rootA)
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(pathA, "ODE657 cuerpo interno.")
      await waitForWatcherOn(rootA)

      const movedPath = join(rootA, "Carta interna renombrada.md")
      renameSync(pathA, movedPath)
      await emitFsWatchEvent([pathA, movedPath], { modify: { kind: "rename", mode: "both" } })
      await advance(500)

      await waitFor(() => bannerText().includes(MOVED_NOTICE), {
        label: "control positivo: la shell avisa 'moved' dentro de una raíz",
        timeoutMs: 15_000,
      })
      expect(bannerText()).not.toContain(DELETED_NOTICE)
      expect(activeTab()?.writing_id).toBe(writingId)
      const record = await waitForCatalogBindingAt(movedPath)
      expect(record.id).toBe(writingId)
      expect(record.binding?.canonicalPath).toBe(movedPath)
      expect((await (await getDocumentCatalog()).resolvePath(pathA)).kind).toBe("unbound")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

describe("ODE-615 — variantes de la prueba WATCH-04", () => {
  async function waitForCatalogDetached(id: string) {
    const catalog = await getDocumentCatalog()
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const record = await catalog.getById(id)
      if (record && !record.localPresent) return record
      await advance(100)
    }
    throw new Error(`El catálogo no desligó ${id}`)
  }

  it(
    "carpeta no registrada: desliga localmente sin documento fantasma y avisa deleted",
    async () => {
      const rootA = makeRoot("Raiz 615 sin registro")
      const pathA = writeMarkdownIn(rootA, "Carta sin registro", "ODE615 cuerpo sin registro.")
      await registerWorkspace(rootA)
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(pathA, "ODE615 cuerpo sin registro.")
      await waitForWatcherOn(rootA)

      // Vecino residente: control positivo de que la raíz A sigue observable y
      // una ausencia real no arrastra a los demás documentos (mismo montaje).
      const neighbourPath = writeMarkdownIn(rootA, "Vecino de A 615", "ODE615 vecino residente.")
      await emitFsWatchEvent([neighbourPath])
      await advance(500)
      await waitForCatalogBindingAt(neighbourPath)

      const outside = join(desktopWorkspaceRoot(), "Fuera de raices 615")
      mkdirSync(outside, { recursive: true })
      const outsidePath = join(outside, "Carta sin registro.md")

      const catalog = await getDocumentCatalog()
      const idsBefore = (await catalog.list())
        .map((row) => row.id)
        .sort()

      renameSync(pathA, outsidePath)
      // El watcher de A ve el rename salir de su alcance; la carpeta destino no
      // está registrada, así que ningún watcher la observa.
      await emitFsWatchEvent([pathA])
      await advance(500)

      const detached = await waitForCatalogDetached(writingId)
      expect(detached.localPresent, "desligado localmente").toBe(false)
      expect(detached.binding ?? null, "sin binding huérfano").toBeNull()
      const idsAfter = (await catalog.list())
        .map((row) => row.id)
        .sort()
      // `list()` filtra las filas sin presencia local ni cloud: el desligado es
      // la única que sale, y ninguna otra entra (no hay documento fantasma).
      expect(idsAfter, "solo sale el desligado; ninguna fila nueva").toEqual(
        idsBefore.filter((id) => id !== writingId),
      )
      expect((await catalog.resolvePath(outsidePath)).kind, "nadie resolvió la ruta externa").toBe(
        "unbound",
      )

      // El aviso de la shell es la proyección de `kind: "deleted"` (el hook
      // `useExternalDocumentChanges.ts:169-173`), no un texto suelto. Se afirma
      // el discriminante tipado en la salida del owner real (el objeto
      // `{ kind, path }` que el hook entrega); el texto visible solo proyecta
      // esa rama y no demuestra el kind.
      await waitFor(
        () => externalNoticeObserver.notices.some((notice) => notice.kind === "deleted"),
        {
          label: "el owner emite el aviso de kind deleted",
          timeoutMs: 15_000,
        },
      )
      const deletedNotice = externalNoticeObserver.notices.find(
        (notice) => notice.kind === "deleted",
      )!
      expect(deletedNotice.path, "el aviso apunta a la ruta que se desligó").toBe(pathA)
      expect(
        externalNoticeObserver.notices.some((notice) => notice.kind === "moved"),
        "ningún aviso moved",
      ).toBe(false)
      expect(bannerText()).toContain(DELETED_NOTICE)
      expect(activeTab()?.writing_id, "la pestaña conserva el UUID").toBe(writingId)
      expect(editorText()).toContain("ODE615 cuerpo sin registro.")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "dos ráfagas: si B llega primero, conserva el UUID original",
    async () => {
      // Decisión de Hugo (2026-10-01): el movimiento repartido en dos ráfagas
      // (>250 ms) queda fuera de alcance y se documenta aquí; el fallo de hoy
      // lo reproduce esta prueba (B acuña un UUID nuevo porque A no está en la
      // pasada y el original queda desligado). Es el failure mode "los eventos
      // llegan con retraso" de WATCH-04, anotado en la fila del capability map.
      const rootA = makeRoot("Raiz 615 A")
      const rootB = makeRoot("Raiz 615 B")
      const pathA = writeMarkdownIn(rootA, "Carta en dos rafagas", "ODE615 cuerpo dos rafagas B.")
      writeMarkdownIn(rootA, "Vecino 615 de A", "ODE615 vecino A.")
      await registerWorkspace(rootA)
      await registerWorkspace(rootB)
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(pathA, "ODE615 cuerpo dos rafagas B.")
      await waitForWatcherOn(rootA)
      await waitForWatcherOn(rootB)

      const pathB = join(rootB, "Carta en dos rafagas.md")
      renameSync(pathA, pathB)
      await emitFsWatchEvent([pathB])
      await advance(500) // primera pasada: solo B
      await emitFsWatchEvent([pathA])
      await advance(500) // segunda pasada (>250 ms después): solo A

      const catalog = await getDocumentCatalog()
      const record = await waitForCatalogBindingAt(pathB)
      expect(record.id, "el UUID de A sobrevive en B").toBe(writingId)
      expect(record.localPresent).toBe(true)
      expect((await catalog.resolvePath(pathA)).kind, "la ruta vieja ya no resuelve").toBe("unbound")
      expect(
        (await catalog.getById(writingId))?.localPresent,
        "el original no queda desligado",
      ).toBe(true)
      await waitFor(() => bannerText().includes(MOVED_NOTICE), {
        label: "la shell avisa moved pese a las dos ráfagas",
        timeoutMs: 15_000,
      })
      expect(bannerText()).not.toContain(DELETED_NOTICE)
      expect(activeTab()?.writing_id).toBe(writingId)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "dos ráfagas: si A llega primero, el detach no se pierde",
    async () => {
      // Misma decisión de alcance que la variante B-primero: la ráfaga que
      // desliga a A pierde la evidencia antes de que B escanee, así que B
      // acuña una identidad nueva en vez de reusar el UUID original.
      const rootA = makeRoot("Raiz 615 A inversa")
      const rootB = makeRoot("Raiz 615 B inversa")
      const pathA = writeMarkdownIn(rootA, "Carta en dos rafagas inversa", "ODE615 cuerpo dos rafagas A.")
      writeMarkdownIn(rootA, "Vecino 615 de A inversa", "ODE615 vecino A inverso.")
      await registerWorkspace(rootA)
      await registerWorkspace(rootB)
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(pathA, "ODE615 cuerpo dos rafagas A.")
      await waitForWatcherOn(rootA)
      await waitForWatcherOn(rootB)

      const pathB = join(rootB, "Carta en dos rafagas inversa.md")
      renameSync(pathA, pathB)
      await emitFsWatchEvent([pathA])
      await advance(500) // primera pasada: solo A desliga
      await emitFsWatchEvent([pathB])
      await advance(500) // segunda pasada (>250 ms después): solo B acuña

      const catalog = await getDocumentCatalog()
      const record = await waitForCatalogBindingAt(pathB)
      expect(record.id, "la evidencia del detach no se pierde: B reusa el UUID").toBe(writingId)
      expect(record.localPresent).toBe(true)
      expect(
        (await catalog.getById(writingId))?.binding?.canonicalPath,
        "el UUID original sigue vivo en B",
      ).toBe(pathB)
      await waitFor(() => bannerText().includes(MOVED_NOTICE), {
        label: "la shell avisa moved pese a las dos ráfagas inversas",
        timeoutMs: 15_000,
      })
      expect(bannerText()).not.toContain(DELETED_NOTICE)
      expect(activeTab()?.writing_id).toBe(writingId)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

/**
 * ODE-661 — review ronda 1 (P1): la raíz de origen vacía.
 *
 * Si el único archivo de A es el que se mueve, A queda sin archivos y la
 * pasada no tiene evidencia de archivos para inferir su volumen; la
 * correlación no puede depender de que la raíz origen conserve archivos para
 * verificar el mismo volumen. Los dos órdenes de llegada (500 ms) conservan el
 * UUID y el barrido escanea cada raíz activa una sola vez, con la raíz origen
 * inspeccionada sin archivos.
 */
describe("ODE-661 — raíz de origen vacía (review ronda 1)", () => {
  it(
    "dos ráfagas con raíz de origen vacía: si B llega primero, conserva el UUID original",
    async () => {
      const rootA = makeRoot("Raiz 661 vacia A")
      const rootB = makeRoot("Raiz 661 vacia B")
      const pathA = writeMarkdownIn(rootA, "Carta origen vacio", "ODE661 cuerpo origen vacio B.")
      await registerWorkspace(rootA)
      await registerWorkspace(rootB)
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(pathA, "ODE661 cuerpo origen vacio B.")
      await waitForWatcherOn(rootA)
      await waitForWatcherOn(rootB)

      const scans = countWorkspaceSyncScans()
      const pathB = join(rootB, "Carta origen vacio.md")
      renameSync(pathA, pathB)
      await emitFsWatchEvent([pathB])
      await advance(500) // primera pasada: solo B
      await waitForCatalogBindingAt(pathB)
      const firstBurstScans = scans.slice()
      await emitFsWatchEvent([pathA])
      await advance(500) // segunda pasada (>250 ms después): solo A

      const catalog = await getDocumentCatalog()
      const record = await waitForCatalogBindingAt(pathB)
      expect(record.id, "el UUID de A sobrevive en B").toBe(writingId)
      expect(record.localPresent).toBe(true)
      expect((await catalog.resolvePath(pathA)).kind, "la ruta vieja ya no resuelve").toBe("unbound")
      expect(
        (await catalog.getById(writingId))?.localPresent,
        "el original no queda desligado",
      ).toBe(true)
      await waitFor(() => bannerText().includes(MOVED_NOTICE), {
        label: "la shell avisa moved pese a las dos ráfagas",
        timeoutMs: 15_000,
      })
      expect(bannerText()).not.toContain(DELETED_NOTICE)
      expect(activeTab()?.writing_id).toBe(writingId)

      // Medición de la pasada sospechosa: la expansión escanea las tres raíces
      // activas una sola vez; la raíz origen vacía no aporta archivos y el
      // destino inspecciona el archivo no ligado.
      const passScans = firstPassScans(firstBurstScans)
      const scansByRoot = new Map(passScans.map((scan) => [scan.rootPath, scan]))
      expect(passScans.length, "la expansión escanea las tres raíces activas").toBe(3)
      expect(scansByRoot.get(rootA)?.files, "la raíz origen vacía no aporta archivos").toBe(0)
      expect(scansByRoot.get(rootB)?.files, "la raíz destino inspecciona el no ligado").toBe(1)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "dos ráfagas con raíz de origen vacía: si A llega primero, el detach no se pierde",
    async () => {
      const rootA = makeRoot("Raiz 661 vacia A inversa")
      const rootB = makeRoot("Raiz 661 vacia B inversa")
      const pathA = writeMarkdownIn(rootA, "Carta origen vacio inversa", "ODE661 cuerpo origen vacio A.")
      await registerWorkspace(rootA)
      await registerWorkspace(rootB)
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(pathA, "ODE661 cuerpo origen vacio A.")
      await waitForWatcherOn(rootA)
      await waitForWatcherOn(rootB)

      const scans = countWorkspaceSyncScans()
      const pathB = join(rootB, "Carta origen vacio inversa.md")
      renameSync(pathA, pathB)
      await emitFsWatchEvent([pathA])
      await advance(500) // primera pasada: solo A desliga
      await waitForCatalogBindingAt(pathB)
      const firstBurstScans = scans.slice()
      await emitFsWatchEvent([pathB])
      await advance(500) // segunda pasada (>250 ms después): solo B acuña

      const catalog = await getDocumentCatalog()
      const record = await waitForCatalogBindingAt(pathB)
      expect(record.id, "la evidencia del detach no se pierde: B reusa el UUID").toBe(writingId)
      expect(record.localPresent).toBe(true)
      expect(
        (await catalog.getById(writingId))?.binding?.canonicalPath,
        "el UUID original sigue vivo en B",
      ).toBe(pathB)
      await waitFor(() => bannerText().includes(MOVED_NOTICE), {
        label: "la shell avisa moved pese a las dos ráfagas inversas",
        timeoutMs: 15_000,
      })
      expect(bannerText()).not.toContain(DELETED_NOTICE)
      expect(activeTab()?.writing_id).toBe(writingId)

      // Medición de la pasada sospechosa: la expansión escanea las tres raíces
      // activas una sola vez; la raíz origen vacía no aporta archivos y el
      // destino inspecciona el archivo no ligado.
      const passScans = firstPassScans(firstBurstScans)
      const scansByRoot = new Map(passScans.map((scan) => [scan.rootPath, scan]))
      expect(passScans.length, "la expansión escanea las tres raíces activas").toBe(3)
      expect(scansByRoot.get(rootA)?.files, "la raíz origen vacía no aporta archivos").toBe(0)
      expect(scansByRoot.get(rootB)?.files, "la raíz destino inspecciona el no ligado").toBe(1)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

/**
 * ODE-661 — coste del barrido. La expansión solo existe para un resultado
 * sospechoso y una vez por ráfaga; la edición normal de un archivo ligado debe
 * seguir costando un scan de su raíz. Se instrumenta el transporte Tauri
 * (boundary externo ya doblado): cada `scanRoot` del reconciler real emite
 * exactamente un `workspace_sync` con `mintUnbound:false`, así que contar
 * `workspace_sync` por `rootPath` cuenta pasadas y archivos inspeccionados
 * (manifest + unbound) sin tocar el owner.
 */
describe("ODE-661 — coste del barrido", () => {
  function writeNeighbours(root: string, prefix: string, count: number) {
    for (let index = 1; index <= count; index += 1) {
      writeMarkdownIn(root, `${prefix} ${index}`, `ODE661 ${prefix} ${index}.`)
    }
  }

  async function waitForCatalogDetached(writingId: string) {
    const catalog = await getDocumentCatalog()
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const record = await catalog.getById(writingId)
      if (record && !record.localPresent) return record
      await advance(100)
    }
    throw new Error(`El catálogo no desligó ${writingId}`)
  }

  it(
    "una edición externa normal escanea solo su raíz",
    async () => {
      const rootA = makeRoot("Raiz coste A")
      const rootB = makeRoot("Raiz coste B")
      const pathA = writeMarkdownIn(rootA, "Carta coste", "ODE661 cuerpo coste.")
      writeNeighbours(rootA, "Vecino coste A", 4)
      writeNeighbours(rootB, "Vecino coste B", 3)
      await registerWorkspace(rootA)
      await registerWorkspace(rootB)
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(pathA, "ODE661 cuerpo coste.")
      await waitForWatcherOn(rootA)
      await waitForWatcherOn(rootB)

      const catalog = await getDocumentCatalog()
      const before = await waitForCatalogBindingAt(pathA)
      expect(before.binding?.contentHash).toBeTruthy()

      const scans = countWorkspaceSyncScans()
      writeFileSync(pathA, "ODE661 cuerpo coste editado.\n")
      await emitFsWatchEvent([pathA])
      await advance(500)

      // Completion event: la fila canónica ya proyecta el hash editado.
      const deadline = Date.now() + 15_000
      let projected = false
      while (Date.now() < deadline) {
        const record = await catalog.getById(writingId)
        if (
          record?.localPresent &&
          record.binding?.contentHash &&
          record.binding.contentHash !== before.binding?.contentHash
        ) {
          projected = true
          break
        }
        await advance(100)
      }
      expect(projected, "el catálogo proyectó la edición normal").toBe(true)
      expect(
        scans.map((scan) => scan.rootPath),
        "la edición normal no lanza un escaneo global",
      ).toEqual([rootA])
      expect(scans[0]?.files, "archivos inspeccionados: solo los del root editado").toBe(5)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "un detach sin par expande una sola vez a las raíces activas",
    async () => {
      const rootA = makeRoot("Raiz coste A inversa")
      const rootB = makeRoot("Raiz coste B inversa")
      const pathA = writeMarkdownIn(rootA, "Carta coste inversa", "ODE661 cuerpo inverso.")
      writeNeighbours(rootA, "Vecino inverso A", 4)
      writeNeighbours(rootB, "Vecino inverso B", 3)
      await registerWorkspace(rootA)
      await registerWorkspace(rootB)
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(pathA, "ODE661 cuerpo inverso.")
      await waitForWatcherOn(rootA)
      await waitForWatcherOn(rootB)

      const outside = join(desktopWorkspaceRoot(), "Fuera de raices 661")
      mkdirSync(outside, { recursive: true })
      const scans = countWorkspaceSyncScans()
      renameSync(pathA, join(outside, "Carta coste inversa.md"))
      // El watcher de A ve el rename salir de su alcance: detach confirmado
      // sin archivo no ligado en la pasada.
      await emitFsWatchEvent([pathA])
      await advance(500)

      await waitForCatalogDetached(writingId)
      const scansByRoot = new Map(scans.map((scan) => [scan.rootPath, scan]))
      // La ráfaga escanea cada raíz activa como máximo una vez: la raíz origen
      // en la fase 1 y, ante el detach sin par, la expansión única que suma
      // las demás raíces (incluida la gestionada), sin repetir ninguna.
      expect(scansByRoot.size, "ninguna raíz se escanea dos veces en la misma ráfaga").toBe(
        scans.length,
      )
      // El documento movido ya no está en A: la raíz origen inspecciona sus 4
      // residentes y el detach se confirma por el binding ausente.
      expect(scansByRoot.get(rootA)?.files, "archivos inspeccionados de la raíz origen").toBe(4)
      expect(
        scansByRoot.get(rootB)?.files,
        "la raíz expandida se inspecciona con sus archivos",
      ).toBe(3)
      expect([...scansByRoot.keys()], "la expansión alcanza todas las raíces activas").toEqual(
        expect.arrayContaining([rootA, rootB]),
      )
      const managedRoot = join(desktopWorkspaceRoot(), "config", "artifact-studio-managed")
      const managedFiles = readdirSync(managedRoot).filter((entry) => entry.endsWith(".md")).length
      expect(
        scansByRoot.get(managedRoot)?.files,
        "la raíz gestionada también entra en la expansión",
      ).toBe(managedFiles)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

/**
 * ODE-661 — review ronda 2 (P1 frescura del volumen recordado, P2 poda).
 *
 * El `st_dev` de dos directorios temporales del harness es el mismo por
 * construcción, así que un cambio de volumen no es fabricable desde el
 * filesystem real. Estas regresiones conducen al owner real
 * (`createWorkspaceReconciler`) con su frontera de scan doblada —`scanRoot`
 * entrega observed/unbound/knownBindings, exactamente como la conecta
 * `desktop-workspace-reconciler.ts`— y afirman sobre el resultado canónico del
 * commit (`upserts`/`detached`), nunca sobre el mapa interno: un volumen
 * recordado que no puede demostrarse vigente no se usa como evidencia, y ante
 * la duda la identidad segura es un UUID nuevo, no ligar mal entre volúmenes.
 */
describe("ODE-661 — frescura y poda del volumen recordado (review ronda 2)", () => {
  const rootA: ReconcilerRoot = {
    id: "root-a",
    rootPath: "/Users/h/Raiz 661 ronda 2 A",
    kind: "external",
    visibleAsWorkspace: true,
    selectedPaths: [],
  }
  const rootB: ReconcilerRoot = {
    id: "root-b",
    rootPath: "/Users/h/Raiz 661 ronda 2 B",
    kind: "external",
    visibleAsWorkspace: true,
    selectedPaths: [],
  }

  function observedInA(): ObservedFile {
    return {
      relativePath: "letter.md",
      canonicalPath: `${rootA.rootPath}/letter.md`,
      inode: 100,
      device: 1,
      contentHash: "blake3:aaa",
      size: 10,
      modifiedAt: 1_000,
      manifestId: "doc-a",
    }
  }

  function knownInA(): KnownBinding {
    return {
      documentId: "doc-a",
      bindingRootId: rootA.id,
      relativePath: "letter.md",
      inode: 100,
      contentHash: "blake3:aaa",
    }
  }

  function unboundInB(): UnboundFile {
    return {
      relativePath: "letter.md",
      inode: 100,
      device: 1,
      contentHash: "blake3:aaa",
      size: 10,
      modifiedAt: 1_000,
    }
  }

  function boundIn(candidate: ReconcilerRoot, ids: Record<string, string>): ObservedFile[] {
    return [
      {
        relativePath: "letter.md",
        canonicalPath: `${candidate.rootPath}/letter.md`,
        inode: 100,
        device: 1,
        contentHash: "blake3:aaa",
        size: 10,
        modifiedAt: 1_000,
        manifestId: ids["letter.md"],
      },
    ]
  }

  function lastCommitFor(commits: ReconcileCommit[], rootId: string) {
    const ofRoot = commits.filter((commit) => commit.bindingRootId === rootId)
    return ofRoot[ofRoot.length - 1]
  }

  it(
    "un cambio de volumen no liga la identidad vieja a otra raíz",
    async () => {
      // Pasada 1: A montada con su archivo en el volumen 1. Pasada 2: A no
      // observable (desmontada) — evidencia de que el volumen recordado no
      // puede darse por vigente. Pasada 3: A re-montada vacía en otro volumen;
      // B ofrece un archivo no ligado con el device, inode y hash viejos de A.
      // Sin frescura, A reutiliza el device obsoleto y B adopta doc-a.
      let mintCounter = 0
      const mintId = () => `uuid-nuevo-${++mintCounter}`
      const commits: ReconcileCommit[] = []
      let phase: "montada" | "desmontada" | "remontada-vacia" = "montada"

      const reconciler = createWorkspaceReconciler({
        loadRoots: async () => [rootA, rootB],
        mintId,
        scanRoot: async (candidate) => {
          if (candidate.id === rootA.id) {
            if (phase === "montada") {
              return { observed: [observedInA()], unbound: [], knownBindings: [] }
            }
            if (phase === "desmontada") {
              return { observed: null, unbound: [], knownBindings: [knownInA()] }
            }
            return { observed: [], unbound: [], knownBindings: [knownInA()] }
          }
          return {
            observed: [],
            unbound: phase === "remontada-vacia" ? [unboundInB()] : [],
            knownBindings: [],
          }
        },
        bindUnbound: async (candidate, ids) => boundIn(candidate, ids),
        commit: async (commit) => {
          commits.push(commit)
        },
      })

      await reconciler.start()
      phase = "desmontada"
      await reconciler.rescanAll()
      phase = "remontada-vacia"
      await reconciler.rescanAll()

      const commitA = lastCommitFor(commits, rootA.id)
      const commitB = lastCommitFor(commits, rootB.id)
      expect(
        commitB?.upserts.map((upsert) => upsert.documentId),
        "B no adopta la identidad de un volumen que no puede demostrarse",
      ).not.toContain("doc-a")
      expect(commitB?.upserts[0]?.documentId, "B acuña una identidad nueva").toMatch(
        /^uuid-nuevo-/,
      )
      expect(
        commitA?.detached,
        "A desliga su binding: no hay correlación entre volúmenes distintos",
      ).toEqual(["doc-a"])
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "una raíz retirada y re-añadida no recupera el volumen recordado",
    async () => {
      // Pasada 1: A montada con su archivo en el volumen 1. Pasada 2: A sale
      // del conjunto activo (retirada). Pasada 3: se re-añade con el mismo id
      // pero vacía, y B ofrece el device, inode y hash viejos de A. Si la
      // evidencia retirada sobrevive, A la reutiliza y B adopta doc-a; la poda
      // acota la tabla a las raíces activas y no resucita evidencia vieja.
      let mintCounter = 0
      const mintId = () => `uuid-nuevo-${++mintCounter}`
      const commits: ReconcileCommit[] = []
      let phase: "montada" | "retirada" | "readoptada" = "montada"

      const reconciler = createWorkspaceReconciler({
        loadRoots: async () => (phase === "retirada" ? [rootB] : [rootA, rootB]),
        mintId,
        scanRoot: async (candidate) => {
          if (candidate.id === rootA.id) {
            if (phase === "montada") {
              return { observed: [observedInA()], unbound: [], knownBindings: [] }
            }
            return { observed: [], unbound: [], knownBindings: [knownInA()] }
          }
          return {
            observed: [],
            unbound: phase === "readoptada" ? [unboundInB()] : [],
            knownBindings: [],
          }
        },
        bindUnbound: async (candidate, ids) => boundIn(candidate, ids),
        commit: async (commit) => {
          commits.push(commit)
        },
      })

      await reconciler.start()
      phase = "retirada"
      await reconciler.rescanAll()
      phase = "readoptada"
      await reconciler.rescanAll()

      const commitA = lastCommitFor(commits, rootA.id)
      const commitB = lastCommitFor(commits, rootB.id)
      expect(
        commitB?.upserts.map((upsert) => upsert.documentId),
        "B no adopta la identidad de un volumen retirado",
      ).not.toContain("doc-a")
      expect(commitB?.upserts[0]?.documentId, "B acuña una identidad nueva").toMatch(
        /^uuid-nuevo-/,
      )
      expect(
        commitA?.detached,
        "A desliga su binding: la evidencia retirada se podó",
      ).toEqual(["doc-a"])
    },
    TEST_TIMEOUT_MS,
  )
})
