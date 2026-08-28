/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-401/ODE-402 — EditorShell "Save to disk / Save As" must not
 * adopt the chosen path when the desktop relocate fails (and must not leave a
 * copy at the destination), and must adopt the relocated — possibly
 * collision-suffixed — path when the move is confirmed.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EditorShell } from "@/components/editor/editor-shell"
import {
  getEditorSessionState,
  resetEditorSessionStoreForTests,
} from "@/lib/stores/editor-session-store"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  invoke: vi.fn(),
  saveDialog: vi.fn(),
  openDialog: vi.fn(),
  relocateDesktopWriting: vi.fn(),
}))

const noopCommand = vi.hoisted(() => vi.fn(() => true))
const editorStub = vi.hoisted(() => {
  const base = {
    commands: new Proxy({}, { get: () => noopCommand }) as Record<string, () => boolean>,
    chain: () => ({
      focus: () => ({
        setTextSelection: () => ({ run: noopCommand }),
      }),
    }),
    getText: () => "Body of the letter",
    getJSON: () => ({ type: "doc", content: [] }),
    getHTML: () => "<p>Letter body</p>",
    schema: { marks: {}, nodes: {} },
    state: { doc: {}, selection: { empty: true } },
    storage: { tableOfContents: {} },
    view: { dom: null },
    on: vi.fn(),
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
    searchParams: new URLSearchParams("?id=writing-1"),
  }),
  usePathname: () => "/write",
  useSearchParams: () => new URLSearchParams("?id=writing-1"),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => true,
}))

vi.mock("@/lib/services/asset-service-factory", () => ({
  getAssetService: () => ({
    readLocalImageAsset: vi.fn(),
    uploadImageAsset: vi.fn(),
  }),
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}))

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: mocks.saveDialog,
  open: mocks.openDialog,
}))

vi.mock("@tiptap/react", () => ({
  useEditor: () => editorStub,
  useEditorState: () => null,
}))

vi.mock("@/hooks/useEditorSelection", () => ({
  useEditorSelection: () => null,
}))

vi.mock("@/lib/services/document-service-factory", () => {
  const writingRecord = {
    id: "writing-1",
    authorId: null,
    title: "Letter",
    content: {
      richText: { type: "doc", content: [] },
      markdown: null,
      plainText: "Body of the letter",
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
  }

  const openWriting = vi.fn(async () => ({ error: null, data: writingRecord }))

  return {
    getDocumentService: vi.fn(async () => ({ openWriting })),
    createDesktopDraft: vi.fn(),
    importDesktopWritingFile: vi.fn(),
    relocateDesktopWriting: mocks.relocateDesktopWriting,
  }
})

vi.mock("@/lib/services/open-document-factory", () => ({
  isUnifiedOpenEnabled: () => false,
  openDocumentById: vi.fn(async () => ({ status: "failed" })),
  openDocumentByIdWithRetry: vi.fn(async () => ({ result: { status: "failed" }, attempt: 1 })),
  openDocumentByPath: vi.fn(async () => ({ status: "failed" })),
  describeOpenOutcome: vi.fn(),
}))

vi.mock("@/lib/local-db", () => {
  const localWriting = {
    id: "writing-1",
    canonical_path: "/managed/Letter.md",
    lifecycle: "local-only",
    sync_status: "synced",
  }

  return {
    getLocalDBScope: () => "scope",
    localDB: {
      writings: {
        get: vi.fn(async () => localWriting),
      },
      correctionBlocks: {
        getByWriting: vi.fn(async () => []),
        deleteMany: vi.fn(),
        delete: vi.fn(),
        save: vi.fn(),
        evictOldestWriting: vi.fn(),
      },
      editorSessions: {
        get: vi.fn(async () => null),
        save: vi.fn(),
      },
    },
    subscribeToLocalDBChanges: () => () => {},
    subscribeToLocalDBScopeChanges: () => () => {},
  }
})

vi.mock("@/lib/editor/desktop-document-engine", () => ({
  desktopDocumentEngine: {
    richToSource: () => ({ success: true, markdown: "# Letter\n" }),
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
  isSuggestionAcceptDisabled: () => false,
  replaceBlockSuggestions: () => [],
  updateSuggestionStatuses: () => [],
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

// Child components — heavy and not exercised by this contract. Mock them to
// keep the mount focused on the shell’s own state and the notice banner.
vi.mock("@/components/editor/editor-topbar", () => ({ EditorTopbar: () => null }))
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

const registeredHandlers = new Map<string, () => unknown>()

let container: HTMLDivElement
let root: Root | null = null

async function emit(action: string) {
  await act(async () => {
    registeredHandlers.get(`menu:${action}`)?.()
  })
}

function getActiveTabTitle() {
  return getEditorSessionState().session.tabs.find((tab) => tab.id === "writing-1")?.title
}

beforeEach(async () => {
  mocks.listen.mockReset()
  mocks.invoke.mockReset()
  mocks.saveDialog.mockReset()
  mocks.openDialog.mockReset()
  mocks.relocateDesktopWriting.mockReset()
  resetEditorSessionStoreForTests()

  // Provide a real DOM element for effects that attach listeners to the editor view.
  ;(editorStub.view as { dom: HTMLElement | null }).dom = document.createElement("div")

  mocks.listen.mockImplementation(async (channel: string, handler: () => unknown) => {
    registeredHandlers.set(channel, handler)
    return () => {}
  })
  mocks.invoke.mockResolvedValue(undefined)
  mocks.saveDialog.mockResolvedValue("/chosen/Renamed.md")

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container.remove()
})

describe("EditorShell save-to-disk relocate behavior", () => {
  it("keeps the original title and writes nothing at the destination when relocate fails", async () => {
    mocks.relocateDesktopWriting.mockResolvedValue({
      status: "failed",
      message: "relocate_file: source not found",
    })

    await act(async () => root?.render(<EditorShell writingId="writing-1" />))

    await vi.waitFor(() => {
      expect(getActiveTabTitle()).toBe("Letter")
    })

    await emit("save-as")

    await vi.waitFor(() =>
      expect(mocks.relocateDesktopWriting).toHaveBeenCalledWith(
        "writing-1",
        "/chosen/Renamed.md",
        "# Letter\n",
      ),
    )

    // 1. No copy may be written at the chosen destination (ODE-402: move, not copy).
    expect(mocks.invoke).not.toHaveBeenCalledWith("write_file", expect.anything())

    // 2. Title must remain the original document title, not the chosen filename.
    expect(getActiveTabTitle()).toBe("Letter")

    // 3. The notice must surface the original canonical path, not the chosen one.
    const text = container.textContent ?? ""
    expect(text).toContain("couldn't be moved to the chosen folder")
    expect(text).toContain("/managed/Letter.md")
    expect(text).not.toContain("/chosen/Renamed.md")
  })

  it("adopts the relocated (collision-suffixed) filename and clears the notice", async () => {
    mocks.relocateDesktopWriting.mockResolvedValue({
      status: "relocated",
      path: "/chosen/Renamed 2.md",
    })

    await act(async () => root?.render(<EditorShell writingId="writing-1" />))

    await vi.waitFor(() => {
      expect(getActiveTabTitle()).toBe("Letter")
    })

    await emit("save-as")

    await vi.waitFor(() =>
      expect(mocks.relocateDesktopWriting).toHaveBeenCalledWith(
        "writing-1",
        "/chosen/Renamed.md",
        "# Letter\n",
      ),
    )

    // Title should follow the FINAL filename resolved by the move (suffix included).
    await vi.waitFor(() => {
      expect(getActiveTabTitle()).toBe("Renamed 2")
    })

    // No failure notice should be rendered.
    const text = container.textContent ?? ""
    expect(text).not.toContain("couldn't be moved to the chosen folder")
  })
})
