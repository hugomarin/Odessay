/** @vitest-environment happy-dom */
/**
 * H1 — custom status/type creation, production consumer assignment, and reload.
 *
 * Proof Contract:
 * - Entry: the Settings editor modal, DeskPage row menu, and the production
 *   DesktopWorkspaceEntry → WorkspaceDetail route.
 * - Real chain: UserSettingsProvider, VocabularyCatalogBridge,
 *   DesktopSettingsService, writing mutations, DesktopDocumentService, and
 *   the filesystem. The Tauri command boundary is doubled; its catalog rows
 *   (SQLite) and settings store are in memory, so this is PARTIAL_INTEGRATION.
 * - Completion: await the real updateWritingsMetadata promise, then wait until
 *   Desk and Workspace have visibly applied the new value before reading the
 *   catalog or file. Reload unmounts the tree, resets the vocabulary catalog,
 *   and mounts a new provider against the persisted settings store.
 * - Negative configuration: the visible controls only offer the closed sets.
 *   The test wraps the real SettingsService method to inject one unsupported
 *   icon into the submitted draft; DesktopSettingsService still validates it,
 *   returns INVALID_INPUT, and the modal displays that error.
 * - Negative assignment: fail the next bulk dual-write and explicitly capture
 *   the unhandled rejection from the existing row callback. The UI has no new
 *   error feedback; catalog, both consumers, and .md retain the prior value.
 */
import { readFile } from "node:fs/promises"
import { basename, join } from "node:path"

import { act, createElement, Fragment, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import {
  failNextBulkDualWrite,
  resetCatalogDoubles,
  resetSettingsStoreDouble,
  tauriCatalogBulkDualWriteDouble,
  tauriCatalogGetByIdDouble,
  tauriCatalogListDouble,
  tauriPathModuleDouble,
} from "../documents/support/real-desktop-doubles"
import {
  bodyJson,
  configureTwoWorkspaceBase,
  registerTwoWorkspaces,
  tauriCommandsModuleDouble,
  type TwoWorkspaceBase,
} from "../documents/support/two-workspace-montage"

vi.mock("@tauri-apps/api/path", () => tauriPathModuleDouble)

vi.mock("@tauri-apps/plugin-dialog", async () => ({
  open: (await import("../documents/support/two-workspace-montage")).unimplemented("open (native folder picker)"),
}))

vi.mock("@/lib/services/desktop/tauri-commands", async () => {
  const { tauriCommandsModuleDouble: buildCommands } = await import("../documents/support/two-workspace-montage")
  const doubles = await import("../documents/support/real-desktop-doubles")
  return buildCommands({
    tauriCatalogListCollectionSnapshot: doubles.tauriCatalogListCollectionSnapshotDouble,
    tauriCatalogSaveCollection: doubles.tauriCatalogSaveCollectionDouble,
    tauriCatalogReplaceWritingCollections: doubles.tauriCatalogReplaceWritingCollectionsDouble,
    tauriCatalogBulkDualWrite: doubles.tauriCatalogBulkDualWriteDouble,
  })
})

vi.mock("@/lib/services/desktop/runtime-detection", async () =>
  (await import("../../support/editor-shell-doubles")).runtimeDetectionDouble(),
)

vi.mock("@/lib/runtime/detect", async () =>
  (await import("../../support/editor-shell-doubles")).tauriRuntimeDetectDouble(),
)

vi.mock("next/navigation", async () =>
  (await import("../../support/editor-shell-doubles")).nextNavigationDouble(),
)

vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))

vi.mock("@/lib/services/sharing-service-factory", () => ({
  createSharingService: () => ({
    getPreviewLink: async () => ({ data: { active: false, token: null, link: null, createdAt: null }, error: null }),
    rotatePreviewLink: async () => ({ data: null, error: null }),
    revokePreviewLink: async () => ({ data: null, error: null }),
  }),
}))

const { createDesktopDraft, getDocumentService } = await import("@/lib/services/document-service-factory")
const { DesktopSettingsService } = await import("@/lib/services/desktop/desktop-settings-service")
const { UserSettingsProvider } = await import("@/components/settings/user-settings-provider")
const { VocabularyCatalogBridge } = await import("@/components/vocabulary/vocabulary-provider")
const { default: WritingStatusSettings } = await import("@/components/settings/writing-status-settings")
const { default: ArtifactTypeSettings } = await import("@/components/settings/artifact-type-settings")
const { resetVocabularyCatalogForTest } = await import("@/lib/vocabulary/catalog")
const { world } = await import("../../support/editor-shell-doubles")

const capturedRowRejections: unknown[] = []
const { DesktopWorkspaceEntry } = await import("@/components/workspace/desktop-workspace-entry")
const { default: DeskPage } = await import("@/app/(app)/desk/page")

type Kind = "status" | "type"
type MountedTree = { unmount: () => Promise<void> }

type KindCase = {
  kind: Kind
  name: string
  invalidName: string
  selectorLabel: string
  baseKey: string
  baseLabel: string
  assignmentAriaLabel: (title: string) => string
  updatePayload: (writingId: string, key: string) => unknown
}

const kindCases: Record<Kind, KindCase> = {
  status: {
    kind: "status",
    name: "Needs Review",
    invalidName: "Rejected Status",
    selectorLabel: "New status",
    baseKey: "draft",
    baseLabel: "Draft",
    assignmentAriaLabel: (title) => `Change status for ${title}`,
    updatePayload: (writingId, key) => ({
      updates: [expect.objectContaining({ writingId, status: key })],
    }),
  },
  type: {
    kind: "type",
    name: "Field Note",
    invalidName: "Rejected Type",
    selectorLabel: "New type",
    baseKey: "general",
    baseLabel: "General",
    assignmentAriaLabel: (title) => `Change artifact type for ${title}`,
    updatePayload: (writingId, key) => ({
      updates: [expect.objectContaining({ writingId, artifactType: key })],
    }),
  },
}

let montage: TwoWorkspaceBase
let mounted: MountedTree | null = null

beforeAll(() => {
  montage = configureTwoWorkspaceBase("odessay-custom-vocabulary-h1-")
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const runtimeGlobals = globalThis as unknown as Record<string, unknown>
  if (typeof runtimeGlobals.ResizeObserver !== "function") {
    runtimeGlobals.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (typeof runtimeGlobals.IntersectionObserver !== "function") {
    runtimeGlobals.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
  }
  if (typeof runtimeGlobals.matchMedia !== "function") {
    runtimeGlobals.matchMedia = (query: string) => ({
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
})

afterAll(() => {
  montage.dispose()
})

beforeEach(() => {
  vi.clearAllMocks()
  resetCatalogDoubles()
  resetSettingsStoreDouble()
  resetVocabularyCatalogForTest()
  world.isDesktop = true
  world.searchParams = new URLSearchParams("slug=workspace-a")
  world.navigations = []
  world.unhandledErrors.length = 0
  capturedRowRejections.length = 0
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
  failNextBulkDualWrite(() => {
    throw new Error("test cleanup")
  })
  try {
    await tauriCatalogBulkDualWriteDouble(join(montage.configDir, "desktop-index.sqlite3"), [])
  } catch {
    // Consume any one-shot bulk-write failure left by a test that failed early.
  }
  document.body.innerHTML = ""
})

function mountProductionSurfaces(kind: Kind): MountedTree {
  const SettingsPage = kind === "status" ? WritingStatusSettings : ArtifactTypeSettings
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  const tree: ReactNode = createElement(
      UserSettingsProvider,
      null,
      createElement(
        Fragment,
        null,
        createElement(VocabularyCatalogBridge),
        createElement(SettingsPage),
        createElement(DeskPage),
        createElement(DesktopWorkspaceEntry),
      ),
    )
  act(() => root.render(tree))
  return {
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function waitUntil(predicate: () => boolean, label: string, timeoutMs = 3500) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) {
      const controls = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .map((button) => ({
          label: button.getAttribute("aria-label"),
          text: button.textContent?.trim(),
          presentation: presentationText(button),
        }))
        .filter((button) => button.label?.startsWith("Change "))
      throw new Error(`waitUntil agotó ${timeoutMs}ms esperando: ${label}; controles=${JSON.stringify(controls)}`)
    }
    await settle()
  }
}

function exactText(scope: ParentNode, text: string): HTMLElement | null {
  return [...scope.querySelectorAll<HTMLElement>("*")].find(
    (element) => element.children.length === 0 && element.textContent?.trim() === text,
  ) ?? null
}

function buttonWithText(text: string): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  ) ?? null
}

function buttonsNamed(name: string, scope: ParentNode = document): HTMLButtonElement[] {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => button.getAttribute("aria-label") === name,
  )
}

function presentationText(element: HTMLElement): string {
  return element.querySelector<HTMLElement>("span.truncate")?.textContent?.trim() ?? ""
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }))
    element.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }))
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
  })
}

async function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await Promise.resolve()
  })
}

async function createProductionDocument() {
  const { rootA, workspaceService } = await registerTwoWorkspaces(montage.baseDir, montage.configDir)
  const title = "H1 vocabulary proof"
  const created = await createDesktopDraft({
    title,
    initialBodyJson: bodyJson("The document body must remain byte-identical."),
    initialBodyText: "The document body must remain byte-identical.",
  })
  expect(created.error).toBeNull()
  const documentId = created.data!.id
  await workspaceService.assignToWorkspace(documentId, "workspace-a")

  const row = await tauriCatalogGetByIdDouble(join(montage.configDir, "desktop-index.sqlite3"), documentId)
  expect(row).not.toBeNull()
  expect(row!.canonicalPath).toContain(rootA)
  const originalBytes = await readFile(row!.canonicalPath!)
  return { documentId, title, fileName: basename(row!.canonicalPath!), canonicalPath: row!.canonicalPath!, originalBytes }
}

async function getStoredVocabulary() {
  const result = await new DesktopSettingsService(montage.configDir).getUserSettings()
  expect(result.error).toBeNull()
  return result.data!.vocabulary
}

function settingsList(kind: Kind) {
  const element = document.querySelector<HTMLElement>(
    `[data-testid="${kind === "status" ? "settings-status" : "settings-artifact-types"}"]`,
  )
  if (!element) throw new Error(`Settings page not mounted for ${kind}`)
  return element
}

async function assertBothConsumers(kind: Kind, title: string, fileName: string, expected: string) {
  const labels = [
    kindCases[kind].assignmentAriaLabel(title),
    kindCases[kind].assignmentAriaLabel(fileName),
  ]
  await waitUntil(() => {
    const triggers = labels.map((label) => buttonsNamed(label))
    return triggers.every((group) => group.length === 1 && presentationText(group[0]!) === expected)
  }, `Desk y Workspace muestran ${expected}`)
}

async function openDeskRowMenu(kind: Kind, title: string) {
  const row = document.querySelector<HTMLElement>('[data-testid="desk-artifact-row"]')
  const trigger = row ? buttonsNamed(kindCases[kind].assignmentAriaLabel(title), row)[0] : null
  if (!trigger) throw new Error(`Desk row trigger not found for ${title}`)
  await click(trigger)
}

async function chooseDeskRowValue(kind: Kind, title: string, valueLabel: string) {
  await openDeskRowMenu(kind, title)
  const menuOptions = () => [...document.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => !button.hasAttribute("aria-label") && presentationText(button) === valueLabel)
  await waitUntil(() => menuOptions().length > 0, `opción ${valueLabel}`)
  const item = menuOptions().at(-1)
  if (!item) throw new Error(`Menu item not found: ${valueLabel}`)
  await click(item)
}

async function chooseWorkspaceRowValue(kind: Kind, fileName: string, valueLabel: string) {
  const ariaLabel = kindCases[kind].assignmentAriaLabel(fileName)
  const trigger = buttonsNamed(ariaLabel)[0]
  if (!trigger) throw new Error(`Workspace trigger not found for ${fileName}`)
  await click(trigger)
  const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .filter((item) => item.textContent?.trim().endsWith(valueLabel))
  await waitUntil(() => menuItems().length > 0, `Workspace opción ${valueLabel}`)
  const item = menuItems()[0]
  if (!item) throw new Error(`Workspace menu item not found: ${valueLabel}`)
  await click(item)
}

async function exerciseKind(kind: Kind) {
  const config = kindCases[kind]
  const file = await createProductionDocument()
  mounted = mountProductionSurfaces(kind)

  await waitUntil(() => Boolean(buttonWithText(config.selectorLabel)), config.selectorLabel)
  await assertBothConsumers(kind, file.title, file.fileName, config.baseLabel)

  // Positive control: the Settings modal creates a durable item through the
  // real provider and DesktopSettingsService before any absence is asserted.
  await click(buttonWithText(config.selectorLabel)!)
  await changeInput(document.querySelector<HTMLInputElement>("#vocabulary-name")!, config.name)
  await click(buttonWithText("Save")!)
  await waitUntil(() => !document.querySelector('[role="dialog"]'), "modal guardado")

  const customKey = kind === "status" ? "needs_review" : "field_note"
  expect(exactText(settingsList(kind), config.name)).not.toBeNull()

  const documentService = await getDocumentService()
  const updateWritingsMetadata = vi.spyOn(documentService, "updateWritingsMetadata")

  await chooseDeskRowValue(kind, file.title, config.name)
  await waitUntil(() => updateWritingsMetadata.mock.calls.length === 1, "updateWritingsMetadata resuelto (positivo)")
  const firstCompletion = updateWritingsMetadata.mock.results[0]!.value as Promise<{
    data: unknown
    error: { message: string } | null
  }>
  const firstResult = await firstCompletion
  expect(firstResult.error).toBeNull()
  expect(updateWritingsMetadata).toHaveBeenCalledWith(config.updatePayload(file.documentId, customKey))
  await assertBothConsumers(kind, file.title, file.fileName, config.name)

  // Real reload: unmount all consumers/provider, reset the module catalog, and
  // let a fresh provider read the store persisted through the test Tauri boundary.
  await mounted.unmount()
  mounted = null
  resetVocabularyCatalogForTest()
  world.searchParams = new URLSearchParams("slug=workspace-a")
  mounted = mountProductionSurfaces(kind)
  await assertBothConsumers(kind, file.title, file.fileName, config.name)
  const vocabulary = await getStoredVocabulary()
  const custom = vocabulary.find((item) => item.kind === kind && item.name === config.name)
  expect(custom).toMatchObject({ kind, name: config.name, key: customKey })
  const dbPath = join(montage.configDir, "desktop-index.sqlite3")
  const assignedRow = await tauriCatalogGetByIdDouble(dbPath, file.documentId)
  expect(assignedRow).toMatchObject({
    id: file.documentId,
    ...(kind === "status" ? { status: customKey } : { artifactType: customKey }),
  })
  expect(await tauriCatalogListDouble(dbPath)).toContainEqual(expect.objectContaining({
    id: file.documentId,
    ...(kind === "status" ? { status: customKey } : { artifactType: customKey }),
  }))
  expect(await readFile(file.canonicalPath)).toEqual(file.originalBytes)

  // Rejected configuration control. The closed icon set cannot produce this
  // value through a user click, so inject it at the real service boundary.
  const storedBeforeInvalid = await getStoredVocabulary()
  const originalCreate = DesktopSettingsService.prototype.createVocabularyItem
  const invalidResults: Awaited<ReturnType<typeof originalCreate>>[] = []
  const createSpy = vi.spyOn(DesktopSettingsService.prototype, "createVocabularyItem").mockImplementation(
    async function (this: InstanceType<typeof DesktopSettingsService>, input) {
      const invalidResult = await originalCreate.call(this, { ...input, icon: "unsupported-icon" as never })
      invalidResults.push(invalidResult)
      return invalidResult
    },
  )
  await click(buttonWithText(config.selectorLabel)!)
  await changeInput(document.querySelector<HTMLInputElement>("#vocabulary-name")!, config.invalidName)
  await click(buttonWithText("Save")!)
  await waitUntil(() => invalidResults.length > 0, "DesktopSettingsService rechazó el icono")
  await waitUntil(() => Boolean(document.querySelector('[role="alert"]')), "error INVALID_INPUT del modal")
  const configAlert = document.querySelector<HTMLElement>('[role="alert"]')!
  expect(configAlert.textContent).toMatch(/icon/i)
  const invalidResult = invalidResults[0]
  if (!invalidResult) throw new Error("DesktopSettingsService no devolvió INVALID_INPUT")
  expect(invalidResult.error?.code).toBe("INVALID_INPUT")
  expect(createSpy).toHaveBeenCalledTimes(1)
  expect(await getStoredVocabulary()).toEqual(storedBeforeInvalid)
  expect(exactText(settingsList(kind), config.invalidName)).toBeNull()
  createSpy.mockRestore()
  await click(buttonWithText("Cancel")!)

  // Assignment failure control. Existing consumers intentionally have no
  // failure feedback; observe the rejected promise explicitly at the runtime
  // rejection boundary and assert canonical state after it settles.
  const assignmentFailure = new Error("synthetic catalog bulk write failure")
  failNextBulkDualWrite(() => {
    throw assignmentFailure
  })
  // WorkspaceDetail's production handler intentionally has no catch. The
  // Desk list currently catches this error and displays its existing generic
  // row status; use Workspace here to characterize the no-feedback path from
  // the accepted decision without adding UI behavior.
  const captureUnhandled = (reason: unknown, promise: Promise<unknown>) => {
    capturedRowRejections.push(reason)
    void promise.catch(() => undefined)
  }
  const captureWindowRejection = (event: PromiseRejectionEvent) => {
    event.preventDefault()
    capturedRowRejections.push(event.reason)
  }
  process.on("unhandledRejection", captureUnhandled)
  window.addEventListener("unhandledrejection", captureWindowRejection)
  try {
    await chooseWorkspaceRowValue(kind, file.fileName, config.baseLabel)
    await waitUntil(() => updateWritingsMetadata.mock.calls.length === 2, "updateWritingsMetadata rechazado")
    const failedCompletion = updateWritingsMetadata.mock.results[1]!.value as Promise<{
      data: unknown
      error: { code: string; message: string } | null
    }>
    const failedResult = await failedCompletion
    expect(failedResult.error).toMatchObject({ code: "DB_ERROR", message: assignmentFailure.message })
    await waitUntil(() => capturedRowRejections.length > 0, "rechazo no manejado capturado")
    expect(capturedRowRejections.map((reason) =>
      typeof reason === "object" && reason !== null && "message" in reason
        ? String((reason as { message: unknown }).message)
        : String(reason),
    )).toContain(assignmentFailure.message)

    const retainedRow = await tauriCatalogGetByIdDouble(dbPath, file.documentId)
    expect(retainedRow).toMatchObject({
      id: file.documentId,
      ...(kind === "status" ? { status: customKey } : { artifactType: customKey }),
    })
    expect(await tauriCatalogListDouble(dbPath)).toContainEqual(expect.objectContaining({
      id: file.documentId,
      ...(kind === "status" ? { status: customKey } : { artifactType: customKey }),
    }))
    await assertBothConsumers(kind, file.title, file.fileName, config.name)
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(document.querySelector('[data-testid="desk-artifact-row-error"]')).toBeNull()
    expect(await readFile(file.canonicalPath)).toEqual(file.originalBytes)
  } finally {
    process.off("unhandledRejection", captureUnhandled)
    window.removeEventListener("unhandledrejection", captureWindowRejection)
  }

  updateWritingsMetadata.mockRestore()
}

describe("H1 custom status create → assign → reload (ODE-678)", () => {
  it("keeps Desk, Workspace, catalog, and .md consistent through success and rejection", async () => {
    await exerciseKind("status")
  })
})

describe("H1 custom artifact type create → assign → reload (ODE-679)", () => {
  it("keeps Desk, Workspace, catalog, and .md consistent through success and rejection", async () => {
    await exerciseKind("type")
  })
})
