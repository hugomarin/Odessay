import { describe, expect, it } from "vitest"
import {
  buildContextEnvelope,
  deriveAvailableSources,
  documentIdsFromSources,
  liveOverrideFromEnvelope,
  selectionFromEnvelope,
  type WorkspaceAgentDocumentSnapshot,
} from "@/lib/agent/context-envelope"
import type { WorkspaceAgentContextAttachment } from "@/lib/agent/workspace-agent-chat"

function attachment(id: string, path = `${id}.md`): WorkspaceAgentContextAttachment {
  return { kind: "file", id, path, label: id }
}

describe("deriveAvailableSources", () => {
  it("puts the focused Writing first when scope is a document, with no attachments", () => {
    const sources = deriveAvailableSources({ kind: "document", id: "doc-1" }, [])
    expect(sources).toEqual([{ kind: "file", documentId: "doc-1", origin: "focused-document" }])
  })

  it("lists the focused Writing, then explicit attachments, in that order", () => {
    const sources = deriveAvailableSources({ kind: "document", id: "doc-1" }, [attachment("doc-2")])
    expect(sources.map((source) => source.documentId)).toEqual(["doc-1", "doc-2"])
    expect(sources.map((source) => source.origin)).toEqual(["focused-document", "explicit-attachment"])
  })

  it("has no focused document when scope is the whole Workspace — only explicit attachments", () => {
    const sources = deriveAvailableSources({ kind: "workspace", rootId: "root-1" }, [attachment("doc-1")])
    expect(sources).toEqual([{ kind: "file", documentId: "doc-1", path: "doc-1.md", label: "doc-1", origin: "explicit-attachment" }])
  })

  it("is empty for a Workspace scope with nothing attached", () => {
    expect(deriveAvailableSources({ kind: "workspace", rootId: "root-1" }, [])).toEqual([])
  })
})

describe("documentIdsFromSources", () => {
  it("dedupes when the focused document is also explicitly attached", () => {
    const sources = deriveAvailableSources({ kind: "document", id: "doc-1" }, [attachment("doc-1"), attachment("doc-2")])
    expect(documentIdsFromSources(sources)).toEqual(["doc-1", "doc-2"])
  })

  it("excludes folder attachments — comparison/read targets need individual document bodies, not an expandable folder reference", () => {
    const folderAttachment: WorkspaceAgentContextAttachment = { kind: "folder", id: "folder-1", path: "notes/", label: "notes" }
    const sources = deriveAvailableSources({ kind: "workspace", rootId: "root-1" }, [attachment("doc-1"), folderAttachment])
    expect(documentIdsFromSources(sources)).toEqual(["doc-1"])
  })
})

describe("buildContextEnvelope — DoD scenarios", () => {
  const baseInput = {
    text: "Hola",
    source: "chat" as const,
    attachments: [] as WorkspaceAgentContextAttachment[],
    recentSessionActions: [] as string[],
  }

  it("a Writing without a visible Workspace: focused document set, no visibleWorkspace, web runtime, no capabilities", () => {
    const envelope = buildContextEnvelope({
      ...baseInput,
      scope: { kind: "document", id: "doc-1" },
      scopeLabel: "Untitled",
      workspaceRootPath: null,
      hasService: false,
    })

    expect(envelope.invocation.location.surface).toBe("writing")
    expect(envelope.invocation.location.focusedDocument).toEqual({ documentId: "doc-1" })
    expect(envelope.invocation.location.visibleWorkspace).toBeUndefined()
    expect(envelope.invocation.runtime.kind).toBe("web")
    expect(envelope.invocation.runtime.capabilities.read).toBe(false)
    expect(envelope.focus).toEqual({ kind: "file", documentId: "doc-1", origin: "focused-document" })
  })

  it("a Writing persisted inside a Workspace: carries both the focused document and the visible Workspace at once", () => {
    const envelope = buildContextEnvelope({
      ...baseInput,
      scope: { kind: "document", id: "doc-1" },
      workspaceRootPath: "/Users/me/Workspace",
      hasService: true,
    })

    expect(envelope.invocation.location.focusedDocument).toEqual({ documentId: "doc-1" })
    expect(envelope.invocation.location.visibleWorkspace).toEqual({ rootId: null, rootPath: "/Users/me/Workspace" })
    expect(envelope.invocation.runtime.kind).toBe("desktop")
    expect(envelope.invocation.runtime.capabilities.read).toBe(true)
  })

  it("a Workspace with a Writing focused by attachment: the attachment becomes the focus, visibleWorkspace still carries the root", () => {
    const envelope = buildContextEnvelope({
      ...baseInput,
      scope: { kind: "workspace", rootId: "root-1" },
      workspaceRootPath: "/Users/me/Workspace",
      attachments: [attachment("doc-9")],
      hasService: true,
    })

    expect(envelope.invocation.location.focusedDocument).toBeUndefined()
    expect(envelope.invocation.location.visibleWorkspace).toEqual({ rootId: "root-1", rootPath: "/Users/me/Workspace" })
    expect(envelope.focus).toMatchObject({ documentId: "doc-9", origin: "explicit-attachment" })
  })

  it("defaults policies.autoSelectRecent to false when not given", () => {
    const envelope = buildContextEnvelope({
      ...baseInput,
      scope: { kind: "workspace", rootId: "root-1" },
      workspaceRootPath: "/root",
      hasService: true,
    })
    expect(envelope.policies.autoSelectRecent).toBe(false)
  })
})

describe("buildContextEnvelope — live snapshot precedence", () => {
  const baseInput = {
    text: "Resume this",
    source: "chat" as const,
    attachments: [] as WorkspaceAgentContextAttachment[],
    recentSessionActions: [] as string[],
    workspaceRootPath: "/root",
    hasService: true,
  }

  it("grounds in the live snapshot when it matches the focused document", () => {
    const snapshot: WorkspaceAgentDocumentSnapshot = { documentId: "doc-1", title: "My draft", markdown: "unsaved text" }
    const envelope = buildContextEnvelope({
      ...baseInput,
      scope: { kind: "document", id: "doc-1" },
      liveSnapshot: snapshot,
    })
    expect(envelope.invocation.location.liveSnapshot).toEqual({ documentId: "doc-1", title: "My draft", markdown: "unsaved text" })
  })

  it("ignores a live snapshot that belongs to a different document than the one in focus", () => {
    const snapshot: WorkspaceAgentDocumentSnapshot = { documentId: "doc-2", title: null, markdown: "unrelated draft text" }
    const envelope = buildContextEnvelope({
      ...baseInput,
      scope: { kind: "document", id: "doc-1" },
      liveSnapshot: snapshot,
    })
    expect(envelope.invocation.location.liveSnapshot).toBeUndefined()
  })

  it("never applies a live snapshot when the scope is the whole Workspace (no single focused document to override)", () => {
    const snapshot: WorkspaceAgentDocumentSnapshot = { documentId: "doc-1", title: null, markdown: "unsaved text" }
    const envelope = buildContextEnvelope({
      ...baseInput,
      scope: { kind: "workspace", rootId: "root-1" },
      attachments: [attachment("doc-1")],
      liveSnapshot: snapshot,
    })
    expect(envelope.invocation.location.liveSnapshot).toBeUndefined()
  })
})

describe("selectionFromEnvelope", () => {
  it("translates available sources into the service's selection shape", () => {
    const envelope = buildContextEnvelope({
      text: "q",
      source: "chat",
      scope: { kind: "document", id: "doc-1" },
      attachments: [attachment("doc-2")],
      recentSessionActions: [],
      hasService: true,
    })
    expect(selectionFromEnvelope(envelope)).toEqual([
      { kind: "file", documentId: "doc-1", path: undefined },
      { kind: "file", documentId: "doc-2", path: "doc-2.md" },
    ])
  })
})

describe("liveOverrideFromEnvelope", () => {
  it("returns the override only when the live snapshot belongs to the turn's focus", () => {
    const envelope = buildContextEnvelope({
      text: "q",
      source: "chat",
      scope: { kind: "document", id: "doc-1" },
      attachments: [],
      recentSessionActions: [],
      hasService: true,
      liveSnapshot: { documentId: "doc-1", title: null, markdown: "live text" },
    })
    expect(liveOverrideFromEnvelope(envelope)).toEqual({ documentId: "doc-1", markdown: "live text" })
  })

  it("returns undefined when there's no live snapshot", () => {
    const envelope = buildContextEnvelope({
      text: "q",
      source: "chat",
      scope: { kind: "document", id: "doc-1" },
      attachments: [],
      recentSessionActions: [],
      hasService: true,
    })
    expect(liveOverrideFromEnvelope(envelope)).toBeUndefined()
  })
})
