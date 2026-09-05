/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-478 cases 2, 4, 5 — a tab switch/close must never attribute a
 * pending edit to the wrong document, must never wipe a still-blank draft's
 * in-progress content, must never leave a completed write with no tab
 * pointing at it, and must never close a tab while its save is still in
 * flight or debounced.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EditorShell } from "@/components/editor/editor-shell"
import { EDITOR_DRAFT_TAB_ID } from "@/lib/local-db/editor-sessions"
import {
  getEditorSessionState,
  resetEditorSessionStoreForTests,
} from "@/lib/stores/editor-session-store"
import { localDB } from "@/lib/local-db"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const runtime = vi.hoisted(() => ({ isDesktop: true }))
const unifiedOpenState = vi.hoisted(() => ({ enabled: false }))
const persistedSession = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }))

type TestWriting = {
  id: string
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
  filesystemWrite: vi.fn(),
  manifestWrite: vi.fn(),
  catalogWrite: vi.fn(),
  syncEnqueue: vi.fn(),
  cloudWrite: vi.fn(),
  createDesktopDraft: vi.fn<(input?: DraftInput) => Promise<{
    error: { code: string; message: string } | null
    data: typeof desktopDraftRecord | null
  }>>(),
  saveWriting: vi.fn(async (input: { writing: TestWriting }) => ({
    error: null,
    data: input.writing,
  })),
  renameWriting: vi.fn(async (input: { writingId: string; title: string }) => ({
    error: null as { code: string; message: string } | null,
    data: { ...desktopDraftRecord, id: input.writingId, title: input.title },
  })),
  openWriting: vi.fn(async () => ({ error: null, data: desktopDraftRecord })),
  openDocumentById: vi.fn(async (_id?: string) => ({ status: "opened", documentId: "restored-writing", record: null })),
}))

const editorState = vi.hoisted(() => ({
  text: "",
  json: { type: "doc", content: [] } as Record<string, unknown>,
  isEmpty: true,
  capturedOnUpdate: null as (({ editor }: { editor: unknown }) => void) | null,
}))

const topbarState = vi.hoisted(() => ({
  onCloseTab: null as ((tabId: string) => void) | null,
  onNewTab: null as (() => void) | null,
  onRenameTab: null as ((tabId: string) => void) | null,
  onSelectTab: null as ((tabId: string) => void) | null,
}))

const renameModalState = vi.hoisted(() => ({
  onConfirm: null as ((title: string) => Promise<boolean>) | null,
}))

const noopCommand = vi.hoisted(() => vi.fn(() => true))
const setContentCommand = vi.hoisted(() => vi.fn((_content?: unknown) => true))

const editorStub = vi.hoisted(() => {
  const base = {
    commands: new Proxy({}, {
      get: (_target, prop) => prop === "setContent" ? setContentCommand : noopCommand,
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
    renameWriting: mocks.renameWriting,
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

vi.mock("@/lib/local-db", () => ({
  getLocalDBScope: () => "scope",
  localDB: {
    writings: {
      get: vi.fn(async () => null),
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
  hashPublicationSource: () => "",
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
  EditorTopbar: (props: {
    onCloseTab?: (tabId: string) => void
    onNewTab?: () => void
    onRenameTab?: (tabId: string) => void
    onSelectTab?: (tabId: string) => void
  }) => {
    topbarState.onCloseTab = props.onCloseTab ?? null
    topbarState.onNewTab = props.onNewTab ?? null
    topbarState.onRenameTab = props.onRenameTab ?? null
    topbarState.onSelectTab = props.onSelectTab ?? null
    return null
  },
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
vi.mock("@/components/editor/modals/insert-image-modal", () => ({ InsertImageModal: () => null }))
vi.mock("@/components/editor/modals/insert-link-modal", () => ({ InsertLinkModal: () => null }))
vi.mock("@/components/editor/modals/insert-table-modal", () => ({ InsertTableModal: () => null }))
vi.mock("@/components/editor/modals/rename-writing-modal", () => ({
  RenameWritingModal: (props: { open: boolean; onConfirm: (title: string) => Promise<boolean> }) => {
    renameModalState.onConfirm = props.open ? props.onConfirm : null
    return null
  },
}))
vi.mock("@/components/editor/panels/notes-panel", () => ({ NotesPanel: () => null }))
vi.mock("@/components/editor/panels/properties-panel", () => ({ PropertiesPanel: () => null }))
vi.mock("@/components/editor/panels/corrections-panel", () => ({ CorrectionsPanel: () => null }))
vi.mock("@/components/editor/panels/table-of-contents-panel", () => ({
  TableOfContentsPanel: () => null,
}))

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

beforeEach(async () => {
  runtime.isDesktop = true
  unifiedOpenState.enabled = false
  persistedSession.value = null
  resetEditorState()
  resetEditorSessionStoreForTests()
  topbarState.onCloseTab = null
  topbarState.onNewTab = null
  topbarState.onRenameTab = null
  topbarState.onSelectTab = null
  renameModalState.onConfirm = null
  setContentCommand.mockClear()
  mocks.createDesktopDraft.mockReset()
  mocks.createDesktopDraft.mockImplementation(async () => {
    mocks.filesystemWrite()
    mocks.manifestWrite()
    mocks.catalogWrite()
    mocks.syncEnqueue()
    return { error: null, data: desktopDraftRecord }
  })
  mocks.filesystemWrite.mockClear()
  mocks.manifestWrite.mockClear()
  mocks.catalogWrite.mockClear()
  mocks.syncEnqueue.mockClear()
  mocks.cloudWrite.mockClear()
  mocks.saveWriting.mockClear()
  mocks.renameWriting.mockClear()
  mocks.openWriting.mockClear()
  mocks.openDocumentById.mockClear()
  window.confirm = vi.fn(() => true)

  // Provide a real DOM element for effects that attach listeners to the editor view.
  ;(editorStub.view as { dom: HTMLElement | null }).dom = document.createElement("div")

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container.remove()
})

describe("ODE-478 case 2 — tab switch must not attribute a pending edit to the wrong document", () => {
  it("flushes the queued rich-mode update against the outgoing tab before switching", async () => {
    persistedSession.value = {
      id: "workspace",
      active_tab_id: "doc-a",
      tabs: [
        { id: "doc-a", writing_id: "doc-a", slug: null, title: "Doc A", save_state: "saved", has_pending_sync: false, last_touched_at: 2, view_state: null },
        { id: "doc-b", writing_id: "doc-b", slug: null, title: "Doc B", save_state: "saved", has_pending_sync: false, last_touched_at: 1, view_state: null },
      ],
      recent_writings: [],
      updated_at: 1,
    }
    mocks.openWriting.mockImplementation(((id?: string) => Promise.resolve({
      error: null,
      data: {
        ...desktopDraftRecord,
        id: id ?? "unknown",
        title: id === "doc-a" ? "Doc A" : "Doc B",
        content: { ...desktopDraftRecord.content, plainText: id === "doc-a" ? "Doc A body" : "Doc B body" },
      },
    })) as never)

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())
    await vi.waitFor(() => expect(mocks.openWriting).toHaveBeenCalledWith("doc-a"))

    // Type in A, then switch to B in the SAME tick — no await boundary in
    // between — so the RAF scheduled by that keystroke is still pending
    // when the switch happens. That's the exact race: a switch landing
    // before the queued update's own animation frame has fired.
    await act(async () => {
      simulateEditorInput("Edited in A")
      topbarState.onSelectTab?.("doc-b")
    })

    await vi.waitFor(() => expect(mocks.saveWriting).toHaveBeenCalled())
    const [savedCall] = mocks.saveWriting.mock.calls
    expect(savedCall[0].writing.id).toBe("doc-a")
    expect(savedCall[0].writing.content.plainText).toBe("Edited in A")
  })
})

describe("ODE-478 case 4 — leaving and returning to a still-materializing draft", () => {
  const SELECCIONADO = "seleccionado-doc"

  it("never wipes the draft's typed content on return, and reconciles the eventual write to exactly one tab", async () => {
    persistedSession.value = {
      id: "workspace",
      active_tab_id: "draft",
      tabs: [
        { id: "draft", writing_id: null, slug: null, title: "Untitled", save_state: "saved-local", has_pending_sync: false, last_touched_at: 2, view_state: null },
        { id: SELECCIONADO, writing_id: SELECCIONADO, slug: null, title: "Seleccionado", save_state: "saved", has_pending_sync: false, last_touched_at: 1, view_state: null },
      ],
      recent_writings: [],
      updated_at: 1,
    }
    mocks.openWriting.mockImplementation(((id?: string) => Promise.resolve({
      error: null,
      data: {
        ...desktopDraftRecord,
        id: id ?? "unknown",
        title: id === SELECCIONADO ? "Seleccionado" : "Untitled",
        content: { ...desktopDraftRecord.content, plainText: id === SELECCIONADO ? "Seleccionado body" : "" },
      },
    })) as never)

    // Materialization takes real time, like the actual desktop write path.
    const deferred: { resolve: (() => void) | null } = { resolve: null }
    mocks.createDesktopDraft.mockReset()
    mocks.createDesktopDraft.mockImplementation(
      () =>
        new Promise((resolve) => {
          deferred.resolve = () => {
            mocks.filesystemWrite()
            mocks.manifestWrite()
            mocks.catalogWrite()
            mocks.syncEnqueue()
            resolve({ error: null, data: desktopDraftRecord })
          }
        }),
    )

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())
    await vi.waitFor(() => expect(getEditorSessionState().session.active_tab_id).toBe("draft"))

    // Type a quick note into the still-blank draft.
    await act(async () => {
      simulateEditorInput("recordar llamar a Juan mañana")
    })

    // Switch away before materialization starts (still inside the debounce).
    await act(async () => {
      topbarState.onSelectTab?.(SELECCIONADO)
    })
    await vi.waitFor(() => expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1))

    setContentCommand.mockClear()

    // Switch back to the draft before its materialization resolves.
    await act(async () => {
      topbarState.onSelectTab?.("draft")
    })

    // Returning must never wipe the screen to empty — the note hasn't
    // reached disk yet, so there is nothing safe to re-hydrate from instead.
    expect(
      setContentCommand.mock.calls.some(
        (call) => JSON.stringify(call[0]) === JSON.stringify({ type: "doc", content: [] }),
      ),
    ).toBe(false)

    // Now let the materialization actually complete.
    await act(async () => {
      deferred.resolve?.()
    })
    await vi.waitFor(() => expect(mocks.filesystemWrite).toHaveBeenCalledTimes(1))

    // The write must be reconciled to exactly one tab — no orphan file with
    // nothing pointing at it.
    await vi.waitFor(() => {
      expect(getEditorSessionState().session.tabs.some((tab) => tab.writing_id === "desktop-draft-1")).toBe(true)
    })
    expect(getEditorSessionState().session.tabs).toHaveLength(2)

    // A further edit to that now-materialized tab must not mint a second
    // file — it saves through the normal named-document path instead.
    await act(async () => {
      topbarState.onSelectTab?.("desktop-draft-1")
    })
    await act(async () => {
      simulateEditorInput("recordar llamar a Juan mañana, urgente")
    })
    await vi.waitFor(() => expect(mocks.saveWriting).toHaveBeenCalled())
    expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1)
  })
})

describe("ODE-478 follow-up — New Tab must not discard a queued edit", () => {
  it("flushes the queued rich-mode update against the outgoing draft before opening a new one", async () => {
    persistedSession.value = {
      id: "workspace",
      active_tab_id: "draft",
      tabs: [
        { id: "draft", writing_id: null, slug: null, title: "Untitled", save_state: "saved-local", has_pending_sync: false, last_touched_at: 1, view_state: null },
      ],
      recent_writings: [],
      updated_at: 1,
    }

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())

    // Type, then immediately hit New Tab in the same tick — no await boundary
    // in between — so the RAF scheduled by that keystroke is still pending
    // when the handler detaches from this draft.
    await act(async () => {
      simulateEditorInput("nota antes de abrir otra pestaña")
      topbarState.onNewTab?.()
    })

    await vi.waitFor(() => expect(mocks.createDesktopDraft).toHaveBeenCalled())
    expect(mocks.createDesktopDraft.mock.calls[0]?.[0]?.initialBodyText).toBe(
      "nota antes de abrir otra pestaña",
    )
  })
})

describe("ODE-478 case 5 — closing a tab waits for its pending save", () => {
  it("keeps the tab open and showing a saving indicator until the write lands, then closes it", async () => {
    persistedSession.value = {
      id: "workspace",
      active_tab_id: "doc-a",
      tabs: [
        { id: "doc-a", writing_id: "doc-a", slug: null, title: "Doc A", save_state: "saved", has_pending_sync: false, last_touched_at: 1, view_state: null },
      ],
      recent_writings: [],
      updated_at: 1,
    }
    mocks.openWriting.mockImplementation(((id?: string) => Promise.resolve({
      error: null,
      data: {
        ...desktopDraftRecord,
        id: id ?? "unknown",
        title: "Doc A",
        content: { ...desktopDraftRecord.content, plainText: "Doc A body" },
      },
    })) as never)

    const deferred: { resolve: (() => void) | null } = { resolve: null }
    mocks.saveWriting.mockImplementation(
      (input: { writing: TestWriting }) =>
        new Promise((resolve) => {
          deferred.resolve = () => resolve({ error: null, data: input.writing })
        }),
    )

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())
    await vi.waitFor(() => expect(mocks.openWriting).toHaveBeenCalledWith("doc-a"))

    await act(async () => {
      simulateEditorInput("Edited, then closed mid-save")
    })

    let closePromise: Promise<void> | undefined
    await act(async () => {
      closePromise = topbarState.onCloseTab?.("doc-a") as Promise<void> | undefined
    })

    // The close must not have removed the tab yet, and must show the author
    // a saving indicator for the wait instead of doing this silently.
    await vi.waitFor(() => {
      const tab = getEditorSessionState().session.tabs.find((t) => t.id === "doc-a")
      expect(tab?.save_state).toBe("saving")
    })
    expect(getEditorSessionState().session.tabs.some((t) => t.id === "doc-a")).toBe(true)
    expect(mocks.saveWriting).toHaveBeenCalled()

    // Now let the write actually complete.
    await act(async () => {
      deferred.resolve?.()
      await closePromise
    })

    await vi.waitFor(() => {
      expect(getEditorSessionState().session.tabs.some((t) => t.id === "doc-a")).toBe(false)
    })
    expect(mocks.saveWriting.mock.calls[0][0].writing.content.plainText).toBe("Edited, then closed mid-save")
  })
})

describe("ODE-478 follow-up — closing a tab whose own materialization completes mid-close", () => {
  it("closes the tab under its new identity instead of silently surviving under the stale draft id", async () => {
    persistedSession.value = {
      id: "workspace",
      active_tab_id: "draft",
      tabs: [
        { id: "draft", writing_id: null, slug: null, title: "Untitled", save_state: "saved-local", has_pending_sync: false, last_touched_at: 1, view_state: null },
      ],
      recent_writings: [],
      updated_at: 1,
    }

    const deferred: { resolve: (() => void) | null } = { resolve: null }
    mocks.createDesktopDraft.mockReset()
    mocks.createDesktopDraft.mockImplementation(
      () =>
        new Promise((resolve) => {
          deferred.resolve = () => {
            mocks.filesystemWrite()
            mocks.manifestWrite()
            mocks.catalogWrite()
            mocks.syncEnqueue()
            resolve({ error: null, data: desktopDraftRecord })
          }
        }),
    )

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())

    await act(async () => {
      simulateEditorInput("cerrar esta pestaña mientras se materializa")
    })

    let closePromise: Promise<void> | undefined
    await act(async () => {
      closePromise = topbarState.onCloseTab?.("draft") as Promise<void> | undefined
    })

    // Closing forces the debounced write through immediately (settle bypasses
    // the debounce), so materialization is already underway.
    await vi.waitFor(() => expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1))

    // The write lands and reconcileMaterializedDraftTab renames "draft" to
    // the real id *before* the close call resumes past its await.
    await act(async () => {
      deferred.resolve?.()
      await closePromise
    })

    await vi.waitFor(() => {
      expect(getEditorSessionState().session.tabs.some((t) => t.id === "desktop-draft-1")).toBe(false)
    })
    // Not just gone from the store — never left an untouched, still-open tab
    // sitting under either id.
    expect(getEditorSessionState().session.tabs.some((t) => t.id === "draft")).toBe(false)
  })
})

describe("ODE-478 follow-up — closing one tab while a different tab's draft materializes mid-close", () => {
  it("opens the renamed background tab, not a stale/blank fallback", async () => {
    persistedSession.value = {
      id: "workspace",
      active_tab_id: "draft",
      tabs: [
        { id: "draft", writing_id: null, slug: null, title: "Untitled", save_state: "saved-local", has_pending_sync: false, last_touched_at: 2, view_state: null },
        { id: "doc-a", writing_id: "doc-a", slug: null, title: "Doc A", save_state: "saved", has_pending_sync: false, last_touched_at: 1, view_state: null },
      ],
      recent_writings: [],
      updated_at: 1,
    }
    mocks.openWriting.mockImplementation(((id?: string) => Promise.resolve({
      error: null,
      data: {
        ...desktopDraftRecord,
        id: id ?? "unknown",
        title: id === "doc-a" ? "Doc A" : "Untitled",
        content: { ...desktopDraftRecord.content, plainText: id === "doc-a" ? "Doc A body" : "" },
      },
    })) as never)

    const draftDeferred: { resolve: (() => void) | null } = { resolve: null }
    mocks.createDesktopDraft.mockReset()
    mocks.createDesktopDraft.mockImplementation(
      () =>
        new Promise((resolve) => {
          draftDeferred.resolve = () => {
            mocks.filesystemWrite()
            mocks.manifestWrite()
            mocks.catalogWrite()
            mocks.syncEnqueue()
            resolve({ error: null, data: desktopDraftRecord })
          }
        }),
    )

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())
    await vi.waitFor(() => expect(getEditorSessionState().session.active_tab_id).toBe("draft"))

    // Start the draft's materialization, then leave it before it resolves.
    await act(async () => {
      simulateEditorInput("nota en segundo plano")
    })
    await act(async () => {
      topbarState.onSelectTab?.("doc-a")
    })
    await vi.waitFor(() => expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(mocks.openWriting).toHaveBeenCalledWith("doc-a"))

    // Now edit and close doc-a — its own settle() must not depend on the
    // background draft, but the background draft is free to materialize
    // (and rename its tab) *during* doc-a's close wait.
    const docADeferred: { resolve: (() => void) | null } = { resolve: null }
    mocks.saveWriting.mockImplementation(
      (input: { writing: TestWriting }) =>
        new Promise((resolve) => {
          docADeferred.resolve = () => resolve({ error: null, data: input.writing })
        }),
    )
    await act(async () => {
      simulateEditorInput("Doc A editado justo antes de cerrar")
    })

    // The coordinator serializes on a single in-flight write, so doc-a's own
    // close settles behind the still-in-flight draft materialization first —
    // that in-flight write resolving (renaming the background tab) is
    // exactly the race under test, before doc-a's own save even starts.
    let closePromise: Promise<void> | undefined
    await act(async () => {
      closePromise = topbarState.onCloseTab?.("doc-a") as Promise<void> | undefined
    })
    expect(mocks.saveWriting).not.toHaveBeenCalled()

    // The background draft's write lands and renames its tab while doc-a's
    // close is still waiting.
    await act(async () => {
      draftDeferred.resolve?.()
    })
    await vi.waitFor(() => {
      expect(getEditorSessionState().session.tabs.some((t) => t.id === "desktop-draft-1")).toBe(true)
    })

    // Only now does doc-a's own save actually start.
    await vi.waitFor(() => expect(mocks.saveWriting).toHaveBeenCalled())

    // A stale post-close lookup falls through to the "no active document"
    // branch, which the session-restore effect then has to correct on a
    // later render — logging this exact line. Watch for that extra,
    // avoidable round-trip instead of only the eventual (self-healed) end
    // state, since that end state is reachable either way.
    const restoreLogSpy = vi.spyOn(console, "info")
    restoreLogSpy.mockClear()

    // Now let doc-a's own save land, completing the close.
    await act(async () => {
      docADeferred.resolve?.()
      await closePromise
    })

    // The only remaining tab is the renamed background draft, and it must be
    // the one the editor actually opens — not a null/blank fallback caused by
    // looking the id up in a stale, pre-rename snapshot of the tab list.
    await vi.waitFor(() => expect(mocks.openWriting).toHaveBeenCalledWith("desktop-draft-1"))
    expect(getEditorSessionState().session.tabs.map((t) => t.id)).toEqual(["desktop-draft-1"])
    expect(
      restoreLogSpy.mock.calls.some((call) => String(call[0]).includes("[editor:session-restore] restorable")),
    ).toBe(false)
    restoreLogSpy.mockRestore()
  })
})
