/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-405 — Desktop must not persist contentless writings on mount
 * or after closing the last tab; the first real input/paste materializes exactly
 * one writing via the desktop write-path. Web keeps its eager local-first behavior.
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
import { hydrateCorrectionBlocksFromRemote, persistCorrectionBlockRemotely } from "@/lib/corrections/persistence"

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
  relocateDesktopWriting: vi.fn<
    (
      writingId: string,
      path: string,
      content: string,
    ) => Promise<{ status: "relocated"; path: string } | { status: "failed"; message: string } | { status: "unsupported" }>
  >(async () => ({ status: "failed", message: "not configured" })),
}))

const saveToDiskState = vi.hoisted(() => ({
  onSaveToDisk: null as ((path: string, content: string) => Promise<string | false>) | null,
  onGetSaveContent: null as (() => { content: string; defaultName: string } | null) | null,
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
}))

const renameModalState = vi.hoisted(() => ({
  onConfirm: null as ((title: string) => Promise<boolean>) | null,
}))

const sheetHeaderState = vi.hoisted(() => ({
  onRunAction: null as ((action: string) => void) | null,
}))

const imageModalState = vi.hoisted(() => ({
  writingId: null as string | null,
}))

const noopCommand = vi.hoisted(() => vi.fn(() => true))
const setContentCommand = vi.hoisted(() => vi.fn(() => true))

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
  relocateDesktopWriting: mocks.relocateDesktopWriting,
}))

vi.mock("@/hooks/useTauriMenuEvents", () => ({
  useTauriMenuEvents: (props: {
    onSaveToDisk?: (path: string, content: string) => Promise<string | false>
    onGetSaveContent?: () => { content: string; defaultName: string } | null
  }) => {
    saveToDiskState.onSaveToDisk = props.onSaveToDisk ?? null
    saveToDiskState.onGetSaveContent = props.onGetSaveContent ?? null
  },
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
  }) => {
    topbarState.onCloseTab = props.onCloseTab ?? null
    topbarState.onNewTab = props.onNewTab ?? null
    topbarState.onRenameTab = props.onRenameTab ?? null
    return null
  },
}))
vi.mock("@/components/editor/editor-sheet-header", () => ({
  EditorSheetHeader: (props: { onRunAction?: (action: string) => void }) => {
    sheetHeaderState.onRunAction = props.onRunAction ?? null
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
vi.mock("@/components/editor/modals/insert-image-modal", () => ({
  InsertImageModal: (props: { open: boolean; writingId: string }) => {
    if (props.open) {
      imageModalState.writingId = props.writingId
    }
    return null
  },
}))
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

// An image node has no extractable text — getText() stays "" — but TipTap's
// own structural isEmpty correctly reports false once an atomic node like an
// image is present (ODE-478 follow-up).
function simulateImageInsert() {
  editorState.text = ""
  editorState.json = { type: "doc", content: [{ type: "image", attrs: { src: "file:///photo.png" } }] }
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
  mocks.relocateDesktopWriting.mockReset()
  mocks.relocateDesktopWriting.mockResolvedValue({ status: "failed", message: "not configured" })
  saveToDiskState.onSaveToDisk = null
  saveToDiskState.onGetSaveContent = null
  sheetHeaderState.onRunAction = null
  imageModalState.writingId = null
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

describe("ODE-405 — desktop empty-draft persistence", () => {
  it("restores the persisted desktop UUID through the unified opener before draft fallback", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    unifiedOpenState.enabled = true
    persistedSession.value = {
      id: "workspace",
      active_tab_id: "restored-writing",
      tabs: [{
        id: "restored-writing",
        writing_id: "restored-writing",
        slug: null,
        title: "Restored",
        save_state: "saved-local",
        has_pending_sync: false,
        last_touched_at: 1,
        view_state: null,
      }],
      recent_writings: [],
      updated_at: 1,
    }

    await act(async () => root?.render(<EditorShell />))

    await vi.waitFor(() => {
      expect(mocks.openDocumentById).toHaveBeenCalledWith("restored-writing")
      expect(mocks.openWriting).toHaveBeenCalledWith("restored-writing")
    })

    expect(mocks.openDocumentById).toHaveBeenCalledTimes(1)
    expect(mocks.openWriting).toHaveBeenCalledTimes(1)
    expect(mocks.createDesktopDraft).not.toHaveBeenCalled()
    expect(getEditorSessionState().session.active_tab_id).toBe("restored-writing")
    expect(infoSpy).toHaveBeenCalledWith(expect.stringMatching(
      /^\[editor:session-restore\] hydrated restored-writing duration_ms=\d+$/,
    ))
    infoSpy.mockRestore()
  })

  it("keeps a persisted draft tab ephemeral when restore has no writing UUID", async () => {
    persistedSession.value = {
      id: "workspace",
      active_tab_id: "draft",
      tabs: [{
        id: "draft",
        writing_id: null,
        slug: null,
        title: "Untitled",
        save_state: "saved-local",
        has_pending_sync: false,
        last_touched_at: 1,
        view_state: null,
      }],
      recent_writings: [],
      updated_at: 1,
    }

    await act(async () => root?.render(<EditorShell />))

    await vi.waitFor(() => {
      expect(getEditorSessionState().session.active_tab_id).toBe(EDITOR_DRAFT_TAB_ID)
    })

    expect(getEditorSessionState().session.tabs).toHaveLength(1)
    expect(getEditorSessionState().session.tabs[0]?.writing_id).toBeNull()
    expect(mocks.createDesktopDraft).not.toHaveBeenCalled()
    expect(mocks.saveWriting).not.toHaveBeenCalled()
    expect(mocks.filesystemWrite).not.toHaveBeenCalled()
    expect(mocks.manifestWrite).not.toHaveBeenCalled()
    expect(mocks.catalogWrite).not.toHaveBeenCalled()
    expect(mocks.syncEnqueue).not.toHaveBeenCalled()
  })

  it("does not materialize a writing when mounting without content", async () => {
    await act(async () => root?.render(<EditorShell />))

    await vi.waitFor(() => {
      expect(getEditorSessionState().loaded).toBe(true)
    })

    expect(mocks.createDesktopDraft).not.toHaveBeenCalled()
    expect(mocks.saveWriting).not.toHaveBeenCalled()
    expect(mocks.filesystemWrite).not.toHaveBeenCalled()
    expect(mocks.manifestWrite).not.toHaveBeenCalled()
    expect(mocks.catalogWrite).not.toHaveBeenCalled()
    expect(mocks.syncEnqueue).not.toHaveBeenCalled()
    expect(mocks.cloudWrite).not.toHaveBeenCalled()

    const session = getEditorSessionState().session
    expect(session.tabs).toHaveLength(0)
    expect(session.active_tab_id).toBeNull()
  })

  it("does not materialize across an empty unmount and remount", async () => {
    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(getEditorSessionState().loaded).toBe(true))

    await act(async () => root?.unmount())
    root = createRoot(container)
    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(getEditorSessionState().loaded).toBe(true))

    expect(mocks.createDesktopDraft).not.toHaveBeenCalled()
    expect(mocks.filesystemWrite).not.toHaveBeenCalled()
    expect(mocks.manifestWrite).not.toHaveBeenCalled()
    expect(mocks.catalogWrite).not.toHaveBeenCalled()
    expect(mocks.syncEnqueue).not.toHaveBeenCalled()
    expect(mocks.cloudWrite).not.toHaveBeenCalled()
  })

  it("materializes exactly one desktop writing on the first real input", async () => {
    await act(async () => root?.render(<EditorShell />))

    await vi.waitFor(() => {
      expect(editorState.capturedOnUpdate).not.toBeNull()
    })

    await simulateEditorInput("First words")

    await vi.waitFor(() => {
      expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1)
    })

    expect(mocks.createDesktopDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        writingId: expect.any(String),
        title: expect.any(String),
        initialBodyText: "First words",
        initialBodyJson: expect.objectContaining({ type: "doc" }),
      }),
    )

    expect(mocks.saveWriting).not.toHaveBeenCalled()
    expect(mocks.filesystemWrite).toHaveBeenCalledTimes(1)
    expect(mocks.manifestWrite).toHaveBeenCalledTimes(1)
    expect(mocks.catalogWrite).toHaveBeenCalledTimes(1)
    expect(mocks.syncEnqueue).toHaveBeenCalledTimes(1)
    expect(mocks.cloudWrite).not.toHaveBeenCalled()
  })

  it("detaches and clears an existing writing before the new draft accepts input", async () => {
    await act(async () => root?.render(<EditorShell writingId="existing-writing" />))
    await vi.waitFor(() => expect(topbarState.onNewTab).not.toBeNull())

    editorState.text = "Existing document content"
    editorState.json = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: editorState.text }] }],
    }
    editorState.isEmpty = false
    setContentCommand.mockClear()

    await act(async () => {
      topbarState.onNewTab?.()
    })

    expect(setContentCommand).toHaveBeenCalledWith({ type: "doc", content: [] })
    expect(getEditorSessionState().session.active_tab_id).toBe(EDITOR_DRAFT_TAB_ID)
    expect(mocks.createDesktopDraft).not.toHaveBeenCalled()

    await simulateEditorInput("First new words")
    await vi.waitFor(() => expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1))
    expect(mocks.createDesktopDraft).toHaveBeenCalledWith(
      expect.objectContaining({ initialBodyText: "First new words" }),
    )
    expect(mocks.saveWriting).not.toHaveBeenCalled()
  })

  it("does not duplicate identity when concurrent updates race during materialization", async () => {
    // Make the first materialization hang so we can interleave a second update.
    const deferred: { resolve: (() => void) | null } = { resolve: null }
    mocks.createDesktopDraft.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deferred.resolve = () => resolve({ error: null, data: desktopDraftRecord })
        }),
    )

    await act(async () => root?.render(<EditorShell />))

    await vi.waitFor(() => {
      expect(editorState.capturedOnUpdate).not.toBeNull()
    })

    await simulateEditorInput("First words")

    await vi.waitFor(() => {
      expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1)
    })

    // A second update while materialization is pending is coalesced and flushed
    // once against the identity produced by the first transition.
    await simulateEditorInput("More words")
    expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1)

    const firstAttemptId = mocks.createDesktopDraft.mock.calls[0]?.[0]?.writingId

    await act(async () => {
      deferred.resolve?.()
    })

    await vi.waitFor(() => {
      expect(mocks.saveWriting).toHaveBeenCalledTimes(1)
    })

    const savedWriting = mocks.saveWriting.mock.calls[0][0].writing
    expect(savedWriting.id).toBe("desktop-draft-1")
    expect(savedWriting.content.plainText).toBe("More words")
    expect(firstAttemptId).toEqual(expect.any(String))
  })

  it("does not materialize a writing from an empty editor update", async () => {
    await act(async () => root?.render(<EditorShell />))

    await vi.waitFor(() => {
      expect(editorState.capturedOnUpdate).not.toBeNull()
    })

    // An empty update (e.g., focus/blur) must not trigger materialization.
    await act(async () => {
      editorState.capturedOnUpdate?.({ editor: editorStub })
    })
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(mocks.createDesktopDraft).not.toHaveBeenCalled()
    expect(mocks.saveWriting).not.toHaveBeenCalled()
  })

  it("reuses the ephemeral identity when first materialization fails and retries", async () => {
    mocks.createDesktopDraft.mockImplementationOnce(async () => ({
      error: { code: "DB_ERROR", message: "temporary failure" },
      data: null,
    }))
    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())

    await simulateEditorInput("First attempt")
    await vi.waitFor(() => expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1))
    const firstIdentity = mocks.createDesktopDraft.mock.calls[0]?.[0]?.writingId

    await simulateEditorInput("Retry content")
    await vi.waitFor(() => expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(2))

    expect(mocks.createDesktopDraft.mock.calls[1]?.[0]?.writingId).toBe(firstIdentity)
  })

  it("closes the last materialized tab without creating a replacement", async () => {
    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())

    await simulateEditorInput("Existing content")
    await vi.waitFor(() => {
      expect(getEditorSessionState().session.tabs).toHaveLength(1)
      expect(topbarState.onCloseTab).not.toBeNull()
    })

    await act(async () => {
      topbarState.onCloseTab?.("desktop-draft-1")
    })

    await vi.waitFor(() => {
      const session = getEditorSessionState().session
      expect(session.tabs).toHaveLength(0)
      expect(session.active_tab_id).toBeNull()
    })
    expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1)
  })

})

describe("ODE-461 — desktop save reliability", () => {
  it("collapses saves fired faster than a round-trip into one in-flight and one queued attempt", async () => {
    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())

    // Materialize first (mirrors the field report: "first autosave: correct").
    await simulateEditorInput("First words")
    await vi.waitFor(() => expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1))
    expect(mocks.saveWriting).not.toHaveBeenCalled()

    // Sustained typing: hang the next save so a second RAF-flushed update
    // lands while it is still in flight, the way keystrokes outrun a save
    // round-trip contended on the same SQLite connection.
    const deferred: { resolve: (() => void) | null } = { resolve: null }
    mocks.saveWriting.mockImplementationOnce(
      (input: { writing: TestWriting }) =>
        new Promise((resolve) => {
          deferred.resolve = () => resolve({ error: null, data: input.writing })
        }),
    )

    await act(async () => {
      simulateEditorInput("Second words")
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    await vi.waitFor(() => expect(mocks.saveWriting).toHaveBeenCalledTimes(1))
    expect(mocks.saveWriting.mock.calls[0][0].writing.content.plainText).toBe("Second words")

    // Another keystroke's own RAF flush fires while the first save still hangs.
    await act(async () => {
      simulateEditorInput("Third words")
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    // Without the single-flight guard this would be a second overlapping
    // `saveWriting` call racing the same connection. It must be queued instead.
    expect(mocks.saveWriting).toHaveBeenCalledTimes(1)

    await act(async () => {
      deferred.resolve?.()
    })

    // The queued snapshot — reflecting the latest content, not "Second
    // words" again — now runs as its own save once the guard clears.
    await vi.waitFor(() => expect(mocks.saveWriting).toHaveBeenCalledTimes(2))
    expect(mocks.saveWriting.mock.calls[1][0].writing.content.plainText).toBe("Third words")
  })

  it("logs the cause and surfaces a distinct error state instead of a perpetual Saving...", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())

    await simulateEditorInput("First words")
    await vi.waitFor(() => expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1))

    mocks.saveWriting.mockImplementationOnce(async () => {
      throw new Error("database is locked")
    })

    await act(async () => {
      simulateEditorInput("Second words")
    })
    await vi.waitFor(() => expect(mocks.saveWriting).toHaveBeenCalledTimes(1))

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        "[editor:save] local save failed",
        expect.objectContaining({ error: "database is locked" }),
      )
    })

    // The failure must not wedge the save path: the next keystroke saves normally.
    await act(async () => {
      simulateEditorInput("Third words")
    })
    await vi.waitFor(() => expect(mocks.saveWriting).toHaveBeenCalledTimes(2))
    expect(mocks.saveWriting.mock.calls[1][0].writing.content.plainText).toBe("Third words")

    errorSpy.mockRestore()
  })
})

/**
 * `clearTimeout(skeletonTimer)` runs unconditionally, immediately after
 * `resolveHydrationOutcome` settles and *before* the generation-owner gate
 * (editor-shell.tsx's hydration effect) — one call per `hydrateEditor`
 * invocation. Waiting for a *new* call after releasing a stale target's hung
 * promise is a positive observable signal that its continuation actually
 * reached the gate, unlike a fixed number of microtask/timer ticks, which
 * proves nothing about whether execution got there.
 */
function spyOnClearTimeout() {
  return vi.spyOn(globalThis, "clearTimeout")
}

async function waitForContinuationToReachGate(clearTimeoutSpy: ReturnType<typeof spyOnClearTimeout>) {
  const callsBefore = clearTimeoutSpy.mock.calls.length
  await vi.waitFor(() => {
    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(callsBefore)
  })
}

describe("ODE-464 — hydration generation owner: deferred stale work", () => {
  it("a stale NOT_FOUND for A resolving after the switch to B must not run tab recovery or touch B's session state", async () => {
    unifiedOpenState.enabled = true
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    const clearTimeoutSpy = spyOnClearTimeout()

    // A's unified-open resolves normally. The subsequent `openWriting` call
    // hangs and resolves late, well after the switch to B; only the generation
    // owner is allowed to decide whether that continuation may still act.
    const releaseA: { release: (() => void) | null } = { release: null }
    mocks.openDocumentById.mockImplementation(((id?: string) =>
      Promise.resolve({ status: "opened", documentId: id ?? "unknown", record: null })) as never)
    mocks.openWriting.mockImplementation(((id?: string) => {
      if (id === "doc-a") {
        // A resolves as gone — the exact shape that used to trigger
        // recoverUnavailableTab() unconditionally, even for a stale target.
        return new Promise((resolve) => {
          releaseA.release = () => resolve({ error: { code: "NOT_FOUND", message: "gone" }, data: null })
        })
      }
      return Promise.resolve({
        error: null,
        data: { ...desktopDraftRecord, id: "doc-b", title: "Doc B", content: { ...desktopDraftRecord.content, plainText: "Doc B body" } },
      })
    }) as never)

    await act(async () => root?.render(<EditorShell writingId="doc-a" />))
    await vi.waitFor(() => expect(mocks.openWriting).toHaveBeenCalledWith("doc-a"))

    // Switch to B before A's hung open call ever resolves — A is now stale.
    await act(async () => root?.render(<EditorShell writingId="doc-b" />))
    await vi.waitFor(() => expect(mocks.openWriting).toHaveBeenCalledWith("doc-b"))
    await vi.waitFor(() => {
      expect(getEditorSessionState().session.tabs.some((tab) => tab.writing_id === "doc-b")).toBe(true)
    })

    const sessionAfterB = getEditorSessionState().session
    const activeTabIdAfterB = sessionAfterB.active_tab_id
    const tabCountAfterB = sessionAfterB.tabs.length

    // Now A's stale open call finally resolves as NOT_FOUND, well after B
    // became the active target. Wait for the positive signal that A's
    // continuation reached the gate, instead of a fixed sleep or microtask count.
    await act(async () => {
      releaseA.release?.()
      await waitForContinuationToReachGate(clearTimeoutSpy)
    })

    // Recovery for A must not have fired at all: `recoverUnavailableTab`
    // unconditionally logs this line as its first statement, so its absence
    // is direct proof the stale outcome was discarded before doing anything —
    // independent of whether "doc-a" ever became a tracked session tab.
    expect(infoSpy).not.toHaveBeenCalledWith(expect.stringContaining("[editor] unavailable writing doc-a"))

    // B's tab is still there, still active, and the session wasn't reset to
    // a fallback/blank state by A's stale resolution.
    const sessionAfterRelease = getEditorSessionState().session
    expect(sessionAfterRelease.active_tab_id).toBe(activeTabIdAfterB)
    expect(sessionAfterRelease.tabs.length).toBe(tabCountAfterB)
    expect(sessionAfterRelease.tabs.some((tab) => tab.writing_id === "doc-b")).toBe(true)

    infoSpy.mockRestore()
    clearTimeoutSpy.mockRestore()
  })

  it("a stale HYDRATED outcome for A (cancelled during the local-metadata read, empty cache) must not start remote correction hydration", async () => {
    unifiedOpenState.enabled = true
    const clearTimeoutSpy = spyOnClearTimeout()

    // This time A's unified-open AND openWriting both succeed. The local-
    // metadata read (`getLocalWriting`) remains in flight while B becomes
    // current; the generation owner must discard A after that await.
    const releaseAMetadata: { release: (() => void) | null } = { release: null }
    mocks.openDocumentById.mockImplementation(((id?: string) =>
      Promise.resolve({ status: "opened", documentId: id ?? "unknown", record: null })) as never)
    mocks.openWriting.mockImplementation(((id?: string) =>
      Promise.resolve({
        error: null,
        data: {
          ...desktopDraftRecord,
          id: id ?? "unknown",
          title: id === "doc-a" ? "Doc A" : "Doc B",
          content: { ...desktopDraftRecord.content, plainText: id === "doc-a" ? "Doc A body" : "Doc B body" },
        },
      })) as never)
    vi.mocked(localDB.writings.get).mockImplementation((id: string) => {
      if (id === "doc-a") {
        return new Promise((resolve) => {
          releaseAMetadata.release = () => resolve(null)
        })
      }
      return Promise.resolve(null)
    })

    await act(async () => root?.render(<EditorShell writingId="doc-a" />))
    await vi.waitFor(() => expect(localDB.writings.get).toHaveBeenCalledWith("doc-a"))

    // Switch to B before A's hung metadata read ever resolves — A is stale.
    await act(async () => root?.render(<EditorShell writingId="doc-b" />))
    await vi.waitFor(() =>
      expect(hydrateCorrectionBlocksFromRemote).toHaveBeenCalledWith("doc-b"),
    )

    // Now release A's metadata read — the coordinator resolves A as
    // "hydrated" well after B has already fully hydrated and started its
    // own correction-block work.
    await act(async () => {
      releaseAMetadata.release?.()
      await waitForContinuationToReachGate(clearTimeoutSpy)
    })

    // Correction-block hydration must never have started for the stale "doc-a"
    // target, even though its outcome ultimately resolved as "hydrated".
    expect(hydrateCorrectionBlocksFromRemote).not.toHaveBeenCalledWith("doc-a")

    clearTimeoutSpy.mockRestore()
  })

  it("a stale HYDRATED outcome for A with a pending CACHED correction block must not flush/persist it remotely", async () => {
    unifiedOpenState.enabled = true
    const clearTimeoutSpy = spyOnClearTimeout()

    // Same shape as the previous case, but A's local cache is non-empty with
    // an unsynced block — this routes through flushPendingCorrectionBlocks()
    // + persistCorrectionBlockRemotely() instead of hydrateCorrectionBlocksFromRemote(),
    // a code path the empty-cache test above cannot exercise.
    const pendingBlockForA = {
      id: "block-a-1",
      writingId: "doc-a",
      blockId: "b1",
      blockHash: "hash-a-1",
      suggestions: [],
      model: "test-model",
      engineRevision: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      latencyMs: null,
      promptTokens: null,
      completionTokens: null,
      syncedAt: null,
    }

    const releaseAMetadata: { release: (() => void) | null } = { release: null }
    mocks.openDocumentById.mockImplementation(((id?: string) =>
      Promise.resolve({ status: "opened", documentId: id ?? "unknown", record: null })) as never)
    mocks.openWriting.mockImplementation(((id?: string) =>
      Promise.resolve({
        error: null,
        data: {
          ...desktopDraftRecord,
          id: id ?? "unknown",
          title: id === "doc-a" ? "Doc A" : "Doc B",
          content: { ...desktopDraftRecord.content, plainText: id === "doc-a" ? "Doc A body" : "Doc B body" },
        },
      })) as never)
    vi.mocked(localDB.writings.get).mockImplementation((id: string) => {
      if (id === "doc-a") {
        return new Promise((resolve) => {
          releaseAMetadata.release = () => resolve(null)
        })
      }
      return Promise.resolve(null)
    })
    vi.mocked(localDB.correctionBlocks.getByWriting).mockImplementation((writingId: string) =>
      Promise.resolve(writingId === "doc-a" ? [pendingBlockForA] : []),
    )

    await act(async () => root?.render(<EditorShell writingId="doc-a" />))
    await vi.waitFor(() => expect(localDB.writings.get).toHaveBeenCalledWith("doc-a"))

    // Switch to B before A's hung metadata read ever resolves — A is stale.
    await act(async () => root?.render(<EditorShell writingId="doc-b" />))
    await vi.waitFor(() =>
      expect(hydrateCorrectionBlocksFromRemote).toHaveBeenCalledWith("doc-b"),
    )

    await act(async () => {
      releaseAMetadata.release?.()
      await waitForContinuationToReachGate(clearTimeoutSpy)
    })

    // A's pending cached block must never be flushed/persisted for the stale target.
    expect(persistCorrectionBlockRemotely).not.toHaveBeenCalledWith(
      expect.objectContaining({ writingId: "doc-a" }),
    )

    clearTimeoutSpy.mockRestore()
  })

  it("discards A when its remote correction response arrives after B has hydrated", async () => {
    unifiedOpenState.enabled = true
    const releaseA: { release: (() => void) | null } = { release: null }
    vi.mocked(hydrateCorrectionBlocksFromRemote).mockClear()
    vi.mocked(persistCorrectionBlockRemotely).mockClear()
    vi.mocked(localDB.writings.get).mockResolvedValue(null)
    vi.mocked(localDB.correctionBlocks.getByWriting).mockResolvedValue([])
    mocks.openDocumentById.mockImplementation(((id?: string) =>
      Promise.resolve({ status: "opened", documentId: id ?? "unknown", record: null })) as never)
    mocks.openWriting.mockImplementation(((id?: string) =>
      Promise.resolve({
        error: null,
        data: {
          ...desktopDraftRecord,
          id: id ?? "unknown",
          title: id === "doc-a" ? "Doc A" : "Doc B",
          content: { ...desktopDraftRecord.content, plainText: id === "doc-a" ? "Doc A body" : "Doc B body" },
        },
      })) as never)
    vi.mocked(hydrateCorrectionBlocksFromRemote).mockImplementation((writingId: string) => {
      if (writingId === "doc-a") {
        return new Promise((resolve) => {
          releaseA.release = () => resolve([])
        })
      }
      return Promise.resolve([])
    })

    await act(async () => root?.render(<EditorShell writingId="doc-a" />))
    await vi.waitFor(() => expect(hydrateCorrectionBlocksFromRemote).toHaveBeenCalledWith("doc-a"))

    await act(async () => root?.render(<EditorShell writingId="doc-b" />))
    await vi.waitFor(() => expect(hydrateCorrectionBlocksFromRemote).toHaveBeenCalledWith("doc-b"))
    await vi.waitFor(() => expect(setContentCommand).toHaveBeenCalled())
    const contentApplicationsAfterB = setContentCommand.mock.calls.length
    expect(
      vi.mocked(hydrateCorrectionBlocksFromRemote).mock.calls.filter(([writingId]) => writingId === "doc-a"),
    ).toHaveLength(1)
    expect(
      vi.mocked(hydrateCorrectionBlocksFromRemote).mock.calls.filter(([writingId]) => writingId === "doc-b"),
    ).toHaveLength(1)

    await act(async () => {
      releaseA.release?.()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(setContentCommand).toHaveBeenCalledTimes(contentApplicationsAfterB)
    expect(persistCorrectionBlockRemotely).not.toHaveBeenCalledWith(
      expect.objectContaining({ writingId: "doc-a" }),
    )
    expect(getEditorSessionState().session.tabs.some((tab) => tab.writing_id === "doc-b")).toBe(true)
  })
})

function blankDraftOnlySession() {
  return {
    id: "workspace",
    active_tab_id: "draft",
    tabs: [{
      id: "draft",
      writing_id: null,
      slug: null,
      title: "Untitled",
      save_state: "saved-local",
      has_pending_sync: false,
      last_touched_at: 1,
      view_state: null,
    }],
    recent_writings: [],
    updated_at: 1,
  }
}

describe("ODE-478 case 3 — naming a still-blank draft", () => {
  it("materializes the draft through the normal write path when confirmed with a name and no content", async () => {
    persistedSession.value = blankDraftOnlySession()

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())
    await vi.waitFor(() => expect(getEditorSessionState().session.active_tab_id).toBe("draft"))

    const draftTabId = getEditorSessionState().session.active_tab_id!

    // The user's very first action: open rename on the still-empty draft.
    await act(async () => { topbarState.onRenameTab?.(draftTabId) })
    await vi.waitFor(() => expect(renameModalState.onConfirm).not.toBeNull())

    let succeeded: boolean | undefined
    await act(async () => {
      succeeded = await renameModalState.onConfirm?.("Nombre que yo quería")
    })

    expect(succeeded).toBe(true)
    expect(mocks.createDesktopDraft).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Nombre que yo quería", initialBodyText: "" }),
    )
    expect(mocks.filesystemWrite).toHaveBeenCalledTimes(1)
    expect(getEditorSessionState().session.tabs.some((tab) => tab.writing_id === "desktop-draft-1")).toBe(true)
  })

  it("reports failure to the modal instead of closing as if it worked", async () => {
    persistedSession.value = blankDraftOnlySession()
    mocks.createDesktopDraft.mockReset()
    mocks.createDesktopDraft.mockImplementation(async () => ({
      error: { code: "DB_ERROR", message: "disk full" },
      data: null,
    }))

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())
    await vi.waitFor(() => expect(getEditorSessionState().session.active_tab_id).toBe("draft"))

    const draftTabId = getEditorSessionState().session.active_tab_id!
    await act(async () => { topbarState.onRenameTab?.(draftTabId) })
    await vi.waitFor(() => expect(renameModalState.onConfirm).not.toBeNull())

    let succeeded: boolean | undefined
    await act(async () => {
      succeeded = await renameModalState.onConfirm?.("Nombre que yo quería")
    })

    expect(succeeded).toBe(false)
    // Still "Untitled": the failed attempt must not silently claim the tab
    // was renamed, and the tab must still be the ephemeral draft.
    expect(getEditorSessionState().session.tabs.some((tab) => tab.writing_id === null)).toBe(true)
  })

  it("waits for the durable write before reporting success, even when an autosave was already in flight (ODE-478 follow-up)", async () => {
    persistedSession.value = blankDraftOnlySession()
    const deferred: { resolve: (() => void) | null } = { resolve: null }
    mocks.createDesktopDraft.mockReset()
    mocks.createDesktopDraft.mockImplementation(
      () =>
        new Promise((resolve) => {
          deferred.resolve = () => {
            mocks.filesystemWrite()
            resolve({ error: null, data: desktopDraftRecord })
          }
        }),
    )

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())
    await vi.waitFor(() => expect(getEditorSessionState().session.active_tab_id).toBe("draft"))

    // Real content triggers the first materialization, left deliberately
    // in flight (deferred) to simulate an autosave already underway.
    await act(async () => {
      simulateEditorInput("contenido real")
    })
    await vi.waitFor(() => expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1))

    // Rename while that write is still in flight — persist()'s "already
    // inFlight" branch resolves optimistically (true) without waiting for
    // the merged request to actually land, which the rename flow must not
    // trust as its success signal.
    const draftTabId = getEditorSessionState().session.active_tab_id!
    await act(async () => {
      topbarState.onRenameTab?.(draftTabId)
    })
    await vi.waitFor(() => expect(renameModalState.onConfirm).not.toBeNull())

    let renamePromise: Promise<boolean> | undefined
    let settledEarly = false
    await act(async () => {
      renamePromise = renameModalState.onConfirm?.("Título mientras se guarda")
      renamePromise?.then(() => {
        settledEarly = true
      })
    })

    // Give pending microtasks a chance to run without ever letting the
    // underlying write land — an implementation trusting the optimistic
    // `persist()` result would already have resolved by now.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(settledEarly).toBe(false)
    expect(mocks.filesystemWrite).not.toHaveBeenCalled()

    // Only once the original write actually lands may the rename resolve.
    await act(async () => {
      deferred.resolve?.()
    })
    const succeeded = await renamePromise
    expect(succeeded).toBe(true)
    await vi.waitFor(() => expect(mocks.saveWriting).toHaveBeenCalled())
    expect(mocks.saveWriting.mock.calls.at(-1)?.[0].writing.title).toBe("Título mientras se guarda")
  })

  it("materializes when the first thing added is an image, not text (ODE-478 follow-up)", async () => {
    persistedSession.value = blankDraftOnlySession()

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())
    await vi.waitFor(() => expect(getEditorSessionState().session.active_tab_id).toBe("draft"))

    await act(async () => {
      simulateImageInsert()
    })

    await vi.waitFor(() => expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1))
    expect(mocks.filesystemWrite).toHaveBeenCalledTimes(1)
    expect(getEditorSessionState().session.tabs.some((tab) => tab.writing_id === "desktop-draft-1")).toBe(true)
  })

  it("materializes the draft before opening Insert Image, so the upload has a real writingId (ODE-478 follow-up)", async () => {
    persistedSession.value = blankDraftOnlySession()

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())
    await vi.waitFor(() => expect(getEditorSessionState().session.active_tab_id).toBe("draft"))
    await vi.waitFor(() => expect(sheetHeaderState.onRunAction).not.toBeNull())

    // Triggering "Insert Image" (Insert menu / Cmd+Shift+I) on a still-blank,
    // unmaterialized draft used to open InsertImageModal with writingId=""
    // — its own upload guard (`if (!file || !writingId) return`) then
    // silently no-ops the whole thing with zero feedback once the user
    // actually picks a file and confirms.
    await act(async () => {
      sheetHeaderState.onRunAction?.("image")
    })

    await vi.waitFor(() => expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(imageModalState.writingId).toBe("desktop-draft-1"))
    expect(imageModalState.writingId).not.toBe("")
  })
})

describe("ODE-478 follow-up — Save As on a still-ephemeral draft", () => {
  it("still offers the native picker when the draft is truly blank — choosing a name is itself a naming signal", async () => {
    persistedSession.value = blankDraftOnlySession()

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())
    await vi.waitFor(() => expect(saveToDiskState.onGetSaveContent).not.toBeNull())

    // Refusing here would stop the native Save panel from ever opening, but
    // choosing a filename in that panel IS the deliberate naming action
    // (same principle as the rename modal in case 3) — it must not be
    // blocked just because the body happens to be empty.
    expect(saveToDiskState.onGetSaveContent?.()).not.toBeNull()
  })

  it("materializes a truly blank draft using the chosen filename as its title", async () => {
    persistedSession.value = blankDraftOnlySession()
    mocks.relocateDesktopWriting.mockResolvedValue({ status: "relocated", path: "/chosen/My Named File.md" })

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())
    await vi.waitFor(() => expect(saveToDiskState.onSaveToDisk).not.toBeNull())

    let result: string | false | undefined
    await act(async () => {
      result = await saveToDiskState.onSaveToDisk?.("/chosen/My Named File.md", "")
    })

    // No content, no prior explicit title — the chosen filename is the only
    // naming signal, and it must be enough to materialize (ODE-478 follow-up).
    expect(mocks.createDesktopDraft).toHaveBeenCalledWith(
      expect.objectContaining({ title: "My Named File" }),
    )
    expect(mocks.relocateDesktopWriting).toHaveBeenCalledWith(
      "desktop-draft-1",
      "/chosen/My Named File.md",
      "",
    )
    expect(result).toBe("/chosen/My Named File.md")
  })

  it("materializes the draft, then relocates it, when there is real content but no writingId yet", async () => {
    persistedSession.value = blankDraftOnlySession()
    mocks.relocateDesktopWriting.mockResolvedValue({ status: "relocated", path: "/chosen/My Note.md" })

    await act(async () => root?.render(<EditorShell />))
    await vi.waitFor(() => expect(editorState.capturedOnUpdate).not.toBeNull())
    await vi.waitFor(() => expect(saveToDiskState.onSaveToDisk).not.toBeNull())

    await act(async () => {
      simulateEditorInput("contenido real antes de guardar")
    })

    // A picker payload is now offered instead of refusing.
    expect(saveToDiskState.onGetSaveContent?.()).not.toBeNull()

    let result: string | false | undefined
    await act(async () => {
      result = await saveToDiskState.onSaveToDisk?.("/chosen/My Note.md", "contenido real antes de guardar")
    })

    // The still-ephemeral draft must materialize (Save As is just as
    // deliberate a signal as typing or naming it) before the relocate call.
    expect(mocks.createDesktopDraft).toHaveBeenCalledTimes(1)
    expect(mocks.relocateDesktopWriting).toHaveBeenCalledWith(
      "desktop-draft-1",
      "/chosen/My Note.md",
      "contenido real antes de guardar",
    )
    expect(result).toBe("/chosen/My Note.md")
  })
})
