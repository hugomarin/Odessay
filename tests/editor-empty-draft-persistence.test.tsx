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
  openWriting: vi.fn(async () => ({ error: null, data: desktopDraftRecord })),
  openDocumentById: vi.fn(async () => ({ status: "opened", documentId: "restored-writing", record: null })),
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
  EditorTopbar: (props: { onCloseTab?: (tabId: string) => void; onNewTab?: () => void }) => {
    topbarState.onCloseTab = props.onCloseTab ?? null
    topbarState.onNewTab = props.onNewTab ?? null
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
vi.mock("@/components/editor/modals/rename-writing-modal", () => ({ RenameWritingModal: () => null }))
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
