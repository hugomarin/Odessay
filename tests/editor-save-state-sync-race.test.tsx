/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-542 — the editor save state converges from the durable
 * DocumentCatalog; an ephemeral `synced` CustomEvent is never the only proof
 * of a terminal state. These are wiring tests (real EditorShell + session
 * store): a deliberately discarded sync event must still converge through
 * the durable projection, and non-reconciliation catalog reasons must not
 * promote a false `Saved` over a newer in-flight local save.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EditorShell } from "@/components/editor/editor-shell"
import {
  getEditorSessionState,
  resetEditorSessionStoreForTests,
  type EditorSessionState,
} from "@/lib/stores/editor-session-store"
import { emitSyncStatusChange } from "@/lib/sync/events"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const runtime = vi.hoisted(() => ({ isDesktop: true }))
const unifiedOpenState = vi.hoisted(() => ({ enabled: false }))
const persistedSession = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }))

type TestWriting = {
  id: string
  title: string
  content: { plainText: string }
}

type DraftInput = {
  writingId?: string
  title?: string
  initialBodyText?: string
  initialBodyJson?: Record<string, unknown>
}

const desktopDraftRecord = vi.hoisted(() => ({
  id: "desktop-draft-1",
  authorId: null,
  title: "Untitled",
  content: {
    richText: { type: "doc", content: [] },
    markdown: null,
    plainText: "",
    canonicalSource: "rich-text",
  },
  slug: null,
  status: "draft",
  artifactType: "general",
  visibility: "private",
  parentId: null,
  correspondenceId: null,
  version: 1,
  deletedAt: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  contentUpdatedAt: "2024-01-01T00:00:00Z",
  metadataUpdatedAt: "2024-01-01T00:00:00Z",
}))

const mocks = vi.hoisted(() => ({
  createDesktopDraft: vi.fn<(input?: DraftInput) => Promise<{
    error: { code: string; message: string } | null
    data: typeof desktopDraftRecord | null
  }>>(),
  saveWriting: vi.fn(async (input: { writing: TestWriting }) => ({
    error: null,
    data: input.writing,
  })),
  openWriting: vi.fn(async () => ({ error: null, data: desktopDraftRecord })),
  openDocumentById: vi.fn(async (_id?: string) => ({ status: "opened", documentId: "x", record: null })),
}))

const editorState = vi.hoisted(() => ({
  text: "",
  json: { type: "doc", content: [] } as Record<string, unknown>,
  isEmpty: true,
  capturedOnUpdate: null as (({ editor }: { editor: unknown }) => void) | null,
}))

const localDbState = vi.hoisted(() => ({
  writingGet: null as unknown as Promise<{
    canonical_path: string | null
    lifecycle: string
    sync_status: string
  } | null> | null,
}))

const catalogState = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>>(),
  listeners: new Set<(change: { documentIds: string[]; reason: string }) => void>(),
}))

const topbarState = vi.hoisted(() => ({
  onCloseTab: null as ((tabId: string) => void) | null,
}))

const noopCommand = vi.hoisted(() => vi.fn(() => true))

const editorStub = vi.hoisted(() => {
  const base = {
    commands: new Proxy({}, {
      get: () => noopCommand,
    }) as Record<string, () => boolean>,
    chain: () => ({
      focus: () => ({
        setTextSelection: () => ({ run: noopCommand }),
      }),
    }),
    getText: () => editorState.text,
    getJSON: () => editorState.json,
    getHTML: () => "<p></p>",
    get isEmpty() {
      return editorState.isEmpty
    },
    schema: { marks: {}, nodes: {} },
    state: { doc: {}, selection: { empty: true } },
    storage: { tableOfContents: {} },
    view: { dom: null },
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "update") {
        editorState.capturedOnUpdate = handler
      }
    }),
    off: vi.fn(),
    isDestroyed: false,
  }

  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) {
        return (target as Record<string, unknown>)[prop as string]
      }
      return noopCommand
    },
  }) as Record<string, unknown>
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    pathname: "/write",
    searchParams: new URLSearchParams(""),
  }),
  usePathname: () => "/write",
  useSearchParams: () => new URLSearchParams(""),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => runtime.isDesktop,
}))

vi.mock("@/lib/services/asset-service-factory", () => ({
  getAssetService: () => ({
    readLocalImageAsset: vi.fn(),
    uploadImageAsset: vi.fn(),
  }),
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}))

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(async () => null),
  open: vi.fn(async () => null),
}))

vi.mock("@/lib/services/desktop/pending-os-open", () => ({
  drainPendingOsOpenPaths: vi.fn(async () => {}),
}))

vi.mock("@tiptap/react", () => ({
  useEditor: (options: { onUpdate?: ({ editor }: { editor: unknown }) => void }) => {
    if (options?.onUpdate) {
      editorState.capturedOnUpdate = options.onUpdate
    }
    return editorStub
  },
  useEditorState: () => null,
}))

vi.mock("@/hooks/useEditorSelection", () => ({
  useEditorSelection: () => null,
}))

vi.mock("@/lib/services/document-service-factory", () => ({
  getDocumentService: vi.fn(async () => ({
    saveWriting: mocks.saveWriting,
    openWriting: mocks.openWriting,
  })),
  createDesktopDraft: mocks.createDesktopDraft,
  importDesktopWritingFile: vi.fn(),
  relocateDesktopWriting: vi.fn(),
}))

vi.mock("@/lib/services/open-document-factory", () => ({
  isUnifiedOpenEnabled: () => unifiedOpenState.enabled,
  openDocumentById: mocks.openDocumentById,
  openDocumentByIdWithRetry: vi.fn(async (id: string) => ({
    result: await mocks.openDocumentById(id),
    attempt: 1,
  })),
  openDocumentByPath: vi.fn(async () => ({ status: "failed" })),
  describeOpenOutcome: vi.fn(),
}))

// ODE-542: the durable catalog is the projection source under test.
vi.mock("@/lib/queries/document-catalog", () => ({
  getCatalogRecord: vi.fn(async (id: string) => catalogState.records.get(id) ?? null),
  subscribeToCatalog: vi.fn((listener: (change: { documentIds: string[]; reason: string }) => void) => {
    catalogState.listeners.add(listener)
    return () => {
      catalogState.listeners.delete(listener)
    }
  }),
}))

vi.mock("@/lib/local-db", () => ({
  getLocalDBScope: () => "scope",
  localDB: {
    writings: {
      get: vi.fn(async () => localDbState.writingGet),
    },
    correctionBlocks: {
      getByWriting: vi.fn(async () => []),
      deleteMany: vi.fn(),
      delete: vi.fn(),
      save: vi.fn(),
      evictOldestWriting: vi.fn(),
    },
    editorSessions: {
      get: vi.fn(async () => persistedSession.value),
      save: vi.fn(),
    },
  },
  subscribeToLocalDBChanges: () => () => {},
  subscribeToLocalDBScopeChanges: () => () => {},
  setLocalDBScope: () => {},
}))

vi.mock("@/lib/editor/desktop-document-engine", () => ({
  desktopDocumentEngine: {
    richToSource: () => ({ success: true, markdown: "" }),
    sourceToRich: () => ({ success: true, snapshot: { bodyJson: { type: "doc", content: [] } } }),
  },
}))

vi.mock("@/lib/editor/extensions", () => ({
  EMPTY_EDITOR_JSON: { type: "doc", content: [] },
  createEditorExtensions: () => [],
  getEditorMarkdown: () => "",
}))

vi.mock("@/lib/editor/correction-trigger-plugin", () => ({
  collectCorrectionBlocks: () => [],
  acknowledgeCorrectionDirtyBlocks: () => {},
  getCurrentCorrectionBlock: () => null,
}))

vi.mock("@/lib/editor/suggestion-engine", () => ({
  applyPublicationSuggestionGroup: () => {},
  deriveSuggestionContexts: () => [],
  getVisibleCorrectionSuggestions: () => [],
  hashPublicationSuggestionSource: () => "",
  invalidateBlockSuggestions: () => [],
  replaceBlockSuggestions: () => [],
  updateSuggestionStatuses: () => [],
  isSuggestionAcceptDisabled: () => false,
}))

vi.mock("@/lib/corrections/persistence", () => ({
  CORRECTION_BLOCK_CACHE_LIMIT: 100,
  createCorrectionBlockRecordId: () => "cb-id",
  DEFAULT_CORRECTION_BLOCK_POSITION_WINDOW: 32,
  findStaleCorrectionBlockRecords: () => [],
  hydrateCorrectionBlocksFromRemote: vi.fn(async () => []),
  parseCorrectionBlockLogicalId: () => null,
  persistCorrectionBlockRemotely: vi.fn(async () => {}),
  reconcileHydratedCorrectionBlocks: () => ({ stale: [], fresh: [] }),
}))

vi.mock("@/lib/corrections/learned-words-loader", () => ({
  loadCachedLearnedWordsPages: () => Promise.resolve({ ok: true, items: [] }),
  mergeLearnedWordEntries: (_existing: unknown, items: unknown) => items,
  primeLearnedWordsCache: () => {},
  upsertCachedLearnedWord: () => {},
  removeCachedLearnedWord: () => {},
  getCachedLearnedWords: () => [],
  resetLearnedWordsCacheForTest: () => {},
  loadLearnedWordsPages: () => Promise.resolve({ ok: true, items: [] }),
}))

vi.mock("@/lib/services/ai-service-factory", () => ({
  getAIService: () => ({
    listLearnedWords: vi.fn(async () => ({ items: [] })),
    learnWord: vi.fn(),
    deleteLearnedWord: vi.fn(),
    reviewPublication: vi.fn(),
  }),
}))

vi.mock("@/lib/editor/find-replace", () => ({
  findReplacePluginKey: { key: "odessay-find-replace" },
  clampFindReplaceIndex: (count: number, idx: number) => idx,
  resolveNextFindReplaceIndex: (_count: number, idx: number, _dir: number) => idx,
  findTextMatches: () => [],
  collectDocumentTextMap: () => ({ fragments: [], offsetMap: [] }),
  findDocumentMatches: () => [],
  replaceMatchInText: (source: string) => source,
  replaceAllMatchesInText: (source: string) => source,
  renderFindReplaceOverlayHtml: () => "",
  getFindReplacePluginState: () => null,
  setFindReplaceQueryState: () => {},
  clearFindReplaceQueryState: () => {},
  FindReplaceExtension: { create: () => ({}) },
  calculateFindReplaceMetrics: () => ({ matchCount: 0, activeMatchIndex: 0 }),
}))

vi.mock("@/lib/editor/publication-suggestion-extension", () => ({
  publicationSuggestionPluginKey: { key: "odessay-publication-suggestions" },
  setPublicationSuggestions: () => {},
  clearPublicationSuggestions: () => {},
  PublicationSuggestionExtension: { create: () => ({}) },
}))

vi.mock("@/lib/editor/footnote-extension", () => ({
  annotateMarkdownStandaloneHighlight: () => "",
  appendMarkdownFootnote: () => "",
  buildAiAnnotationCopy: () => "",
  changeMarkdownAnnotationType: () => "",
  extractAiAnnotationsFromMarkdown: () => "",
  extractRichEditorAnnotations: () => [],
  extractStandaloneHighlights: () => [],
  getMarkdownFootnotes: () => [],
  normalizeMarkdownFootnotes: (markdown: string) => markdown,
  removeMarkdownAnnotation: () => "",
  removeMarkdownFootnote: () => "",
  removeMarkdownStandaloneHighlight: () => "",
  updateMarkdownAnnotation: () => "",
  updateMarkdownFootnote: () => "",
}))

vi.mock("@/lib/editor/footnote-node", () => ({
  FOOTNOTE_REF_EVENT: "odessay:footnote-ref",
  getEditorFootnotes: () => [],
  getMarkdownWithFootnoteDefinitions: (markdown: string) => markdown,
  AnnotationType: { PERSONAL: "personal", EDITORIAL: "editorial", READER: "reader" },
}))

vi.mock("@/components/editor/editor-topbar", () => ({
  EditorTopbar: (props: { onCloseTab?: (tabId: string) => void }) => {
    topbarState.onCloseTab = props.onCloseTab ?? null
    return null
  },
}))
vi.mock("@/components/editor/editor-sheet-header", () => ({
  EditorSheetHeader: () => null,
}))
vi.mock("@/components/editor/editor-content", () => ({ WritingEditorContent: () => null }))
vi.mock("@/components/editor/editor-empty-state", () => ({ EditorEmptyState: () => null }))
vi.mock("@/components/editor/editor-find-replace", () => ({ EditorFindReplace: () => null }))
vi.mock("@/components/editor/editor-shortcuts-dialog", () => ({ EditorShortcutsDialog: () => null }))
vi.mock("@/components/editor/mobile-write-notice", () => ({ MobileWriteNotice: () => null }))
vi.mock("@/components/editor/status-bar", () => ({ EditorStatusBar: () => null }))
vi.mock("@/components/reading/margins/annotation-bubble", () => ({ AnnotationBubble: () => null }))
vi.mock("@/components/reading/margins/selection-popup", () => ({ SelectionPopup: () => null }))
vi.mock("@/components/editor/modals/insert-footnote-modal", () => ({
  InsertFootnoteModal: () => null,
}))
vi.mock("@/components/editor/modals/insert-image-modal", () => ({
  InsertImageModal: () => null,
}))
vi.mock("@/components/editor/modals/insert-link-modal", () => ({ InsertLinkModal: () => null }))
vi.mock("@/components/editor/modals/insert-table-modal", () => ({ InsertTableModal: () => null }))
vi.mock("@/components/editor/modals/rename-writing-modal", () => ({
  RenameWritingModal: () => null,
}))
vi.mock("@/components/editor/panels/notes-panel", () => ({ NotesPanel: () => null }))
vi.mock("@/components/editor/panels/properties-panel", () => ({ PropertiesPanel: () => null }))
vi.mock("@/components/editor/panels/corrections-panel", () => ({ CorrectionsPanel: () => null }))
vi.mock("@/components/editor/panels/table-of-contents-panel", () => ({
  TableOfContentsPanel: () => null,
}))

function catalogRecord(overrides: {
  id: string
  syncStatus: string
  cloudPresent: boolean
}): Record<string, unknown> {
  return {
    id: overrides.id,
    localPresent: true,
    cloudPresent: overrides.cloudPresent,
    cloudAccountId: null,
    syncStatus: overrides.syncStatus,
    title: "Doc",
    slug: null,
    status: "draft",
    artifactType: "general",
    visibility: "private",
    version: 1,
    deletedAt: null,
    createdAt: 1,
    modifiedAt: 1,
    binding: {
      documentId: overrides.id,
      bindingRootId: "root",
      relativePath: "Doc.md",
      canonicalPath: "/tmp/Doc.md",
      inode: 1,
      contentHash: "hash",
      size: 1,
      lastSeenAt: 1,
    },
  }
}

function fireCatalogChange(documentIds: string[], reason: string) {
  const change = { transactionId: "tx", documentIds, reason, occurredAt: Date.now() }
  catalogState.listeners.forEach((listener) => listener(change))
}

let container: HTMLDivElement
let root: Root | null = null

function resetEditorState() {
  editorState.text = ""
  editorState.json = { type: "doc", content: [] }
  editorState.isEmpty = true
  editorState.capturedOnUpdate = null
}

function simulateEditorInput(text: string) {
  editorState.text = text
  editorState.json = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
  editorState.isEmpty = false
  if (editorState.capturedOnUpdate) {
    editorState.capturedOnUpdate({ editor: editorStub })
  }
}

const tabState = (writingId: string) => {
  const session = getEditorSessionState().session
  return session.tabs.find((tab) => tab.id === writingId || tab.writing_id === writingId) ?? null
}

beforeEach(async () => {
  runtime.isDesktop = true
  unifiedOpenState.enabled = false
  persistedSession.value = null
  resetEditorState()
  resetEditorSessionStoreForTests()
  catalogState.records.clear()
  catalogState.listeners.clear()
  localDbState.writingGet = null
  topbarState.onCloseTab = null
  mocks.createDesktopDraft.mockReset()
  mocks.createDesktopDraft.mockImplementation(async () => ({ error: null, data: desktopDraftRecord }))
  mocks.saveWriting.mockReset()
  mocks.saveWriting.mockImplementation(async (input: { writing: TestWriting }) => ({
    error: null,
    data: input.writing,
  }))
  mocks.openWriting.mockReset()
  mocks.openWriting.mockImplementation(async () => ({ error: null, data: desktopDraftRecord }))
  mocks.openDocumentById.mockReset()
  mocks.openDocumentById.mockImplementation(async () => ({ status: "opened", documentId: "x", record: null }))
  window.confirm = vi.fn(() => true)
  ;(editorStub.view as { dom: HTMLElement | null }).dom = document.createElement("div")

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

/**
 * Session-store writes made through publishTabState only land after a React
 * render, so every store-level wait must flush renders between polls — a bare
 * `vi.waitFor` can observe a pre-render snapshot forever.
 */
async function waitForSession(assert: () => void, timeout = 8000) {
  const deadline = Date.now() + timeout
  let lastError: unknown = null
  for (;;) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    try {
      assert()
      return
    } catch (error) {
      lastError = error
      if (Date.now() > deadline) {
        throw lastError
      }
    }
  }
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container.remove()
})

describe("ODE-542 — durable save-state convergence wiring", () => {
  it("converges to Saved after hydration even when the synced event is deliberately never delivered", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    // Hydration starts with a stale durable snapshot: pending + cloud.
    localDbState.writingGet = Promise.resolve({
      canonical_path: "/tmp/Doc.md",
      lifecycle: "server-confirmed",
      sync_status: "pending",
    })
    // The flush completes mid-hydration. NO sync CustomEvent is dispatched —
    // the event is discarded, exactly the DoD case.
    catalogState.records.set(
      "existing-writing",
      catalogRecord({ id: "existing-writing", syncStatus: "synced", cloudPresent: true }),
    )

    // The shell's hydration effect can restart (session-store loads change
    // its deps), so EVERY openWriting call hangs until the test releases the
    // queue — a settled early generation must not hydrate with wrong data.
    const deferred: { release: () => void } = { release: () => {} }
    const openWritingWaiters: Array<(value: unknown) => void> = []
    mocks.openWriting.mockImplementation(
      () =>
        new Promise((resolve) => {
          openWritingWaiters.push(() =>
            resolve({
              error: null,
              data: {
                ...desktopDraftRecord,
                id: "existing-writing",
                title: "Doc",
                createdAt: "2024-01-01T00:00:00Z",
              },
            }),
          )
        }),
    )
    deferred.release = () => {
      while (openWritingWaiters.length > 0) openWritingWaiters.shift()?.(null)
    }

    await act(async () => root?.render(<EditorShell writingId="existing-writing" />))
    await waitForSession(() => expect(mocks.openWriting).toHaveBeenCalled())

    await act(async () => {
      deferred.release()
    })

    // The one-shot hydration snapshot projects pending -> Saving; the
    // post-hydration durable re-read must correct it to Saved with no tab
    // switch, no remount and no event.
    await waitForSession(() => {
      const tab = getEditorSessionState().session.tabs.find((tab) => tab.id === "existing-writing")
      expect(tab?.save_state).toBe("saved")
      expect(tab?.has_pending_sync).toBe(false)
    })
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("reason=post-hydration"),
    )
    expect(getEditorSessionState().session.active_tab_id).toBe("existing-writing")
    infoSpy.mockRestore()
  }, 12_000)

  it("heals a draft whose flush already committed while materialization was in flight (no sync event)", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const deferred: { resolve: (() => void) | null } = { resolve: null }
    mocks.createDesktopDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deferred.resolve = () => resolve({ error: null, data: desktopDraftRecord })
        }),
    )

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())

    await simulateEditorInput("First words")
    await waitForSession(() => expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1))

    // Fast flush: the durable catalog already says synced for the materialized
    // UUID BEFORE the shell learns it. No sync CustomEvent is delivered.
    catalogState.records.set(
      "desktop-draft-1",
      catalogRecord({ id: "desktop-draft-1", syncStatus: "synced", cloudPresent: true }),
    )

    await act(async () => {
      deferred.resolve?.()
    })

    // The event the old per-id subscription would have dropped is absent;
    // materialization + post-hydration reconciliation must still converge.
    await waitForSession(() => {
      const session = getEditorSessionState().session
      const tab = session.tabs.find((tab) => tab.id === "desktop-draft-1")
      expect(tab?.save_state).toBe("saved")
      expect(tab?.has_pending_sync).toBe(false)
      expect(session.tabs).toHaveLength(1)
      expect(session.active_tab_id).toBe("desktop-draft-1")
    })
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[editor:save-state\] reconcile writingId=desktop-draft-1 .*reason=(materialized|post-hydration)/),
    )
    infoSpy.mockRestore()
  }, 12_000)

  it("does not promote a false Saved from stale catalog reasons while a save is in flight", async () => {
    // Seed the durable terminal from the PREVIOUS save BEFORE hydration so
    // the one-shot snapshot itself projects Saved.
    localDbState.writingGet = Promise.resolve({
      canonical_path: "/tmp/Doc.md",
      lifecycle: "server-confirmed",
      sync_status: "synced",
    })
    catalogState.records.set(
      "existing-writing",
      catalogRecord({ id: "existing-writing", syncStatus: "synced", cloudPresent: true }),
    )

    await act(async () => root?.render(<EditorShell writingId="existing-writing" />))
    await waitForSession(() => {
      const tab = getEditorSessionState().session.tabs.find((tab) => tab.id === "existing-writing")
      expect(tab?.save_state).toBe("saved")
    })

    // New local save in flight: the durable row still describes the previous
    // save (synced) while the editor shows Saving...
    const deferred: { resolve: (() => void) | null } = { resolve: null }
    mocks.saveWriting.mockImplementationOnce(
      (input: { writing: TestWriting }) =>
        new Promise((resolve) => {
          deferred.resolve = () => resolve({ error: null, data: input.writing })
        }),
    )
    await act(async () => {
      simulateEditorInput("New words")
    })
    await waitForSession(() => {
      const tab = getEditorSessionState().session.tabs.find((tab) => tab.id === "existing-writing")
      expect(tab?.save_state).toBe("saving")
    })

    // A stale non-reconciliation reason (excerpt) must NOT promote Saved.
    await act(async () => {
      fireCatalogChange(["existing-writing"], "excerpt")
      await new Promise((resolve) => setTimeout(resolve, 25))
    })
    expect(
      getEditorSessionState().session.tabs.find((tab) => tab.id === "existing-writing")?.save_state,
    ).toBe("saving")

    // The flush-confirmed projection may heal: the in-flight save resolves
    // first, then the cloud-snapshot converges the indicator.
    await act(async () => {
      deferred.resolve?.()
    })
    await act(async () => {
      fireCatalogChange(["existing-writing"], "cloud-snapshot")
    })
    await waitForSession(() => {
      const tab = getEditorSessionState().session.tabs.find((tab) => tab.id === "existing-writing")
      expect(tab?.save_state).toBe("saved")
      expect(tab?.has_pending_sync).toBe(false)
    })
  }, 15_000)

  it("routes a synced event for the active document through the durable read, not blind mapping", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    await act(async () => root?.render(<EditorShell writingId="existing-writing" />))

    localDbState.writingGet = Promise.resolve({
      canonical_path: "/tmp/Doc.md",
      lifecycle: "server-confirmed",
      sync_status: "pending",
    })
    catalogState.records.set(
      "existing-writing",
      catalogRecord({ id: "existing-writing", syncStatus: "synced", cloudPresent: true }),
    )

    await waitForSession(() => {
      expect(getEditorSessionState().session.active_tab_id).toBe("existing-writing")
    })

    // The ephemeral event is only an invalidation: the terminal state must
    // come from the durable catalog snapshot.
    await act(async () => {
      emitSyncStatusChange({ writingId: "existing-writing", status: "synced" })
    })

    await waitForSession(() => {
      const tab = getEditorSessionState().session.tabs.find((tab) => tab.id === "existing-writing")
      expect(tab?.save_state).toBe("saved")
      expect(tab?.has_pending_sync).toBe(false)
    })
    infoSpy.mockRestore()
  }, 12_000)
})
