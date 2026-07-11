import { describe, expect, it, vi } from "vitest"
import type {
  DocumentCatalogRecord,
  PathResolution,
  RegisterBindingInput,
} from "@/lib/services/contracts/document-catalog"
import {
  createOpenDocumentUseCase,
  type BindingRootLocation,
  type BindingRootMatch,
  type FileOpenEvidence,
  type OpenDocumentPorts,
} from "@/lib/services/open-document"

// ── Fakes ──────────────────────────────────────────────────────────────────────

function makeRecord(
  overrides: Partial<DocumentCatalogRecord> & { id: string },
): DocumentCatalogRecord {
  return {
    localPresent: true,
    cloudPresent: false,
    cloudAccountId: null,
    syncStatus: "local-only",
    title: "Doc",
    slug: null,
    status: null,
    artifactType: null,
    visibility: null,
    version: null,
    createdAt: 1,
    modifiedAt: 1,
    binding: null,
    ...overrides,
  }
}

/** In-memory catalog: getById / resolvePath / registerBinding over a Map. */
function fakeCatalog(seed: DocumentCatalogRecord[] = []) {
  const byId = new Map(seed.map((record) => [record.id, record]))
  return {
    byId,
    getById: vi.fn(async (id: string) => byId.get(id) ?? null),
    resolvePath: vi.fn(async (path: string): Promise<PathResolution> => {
      for (const record of byId.values()) {
        if (record.binding?.canonicalPath === path) return { kind: "resolved", record }
      }
      return { kind: "unbound", path }
    }),
    registerBinding: vi.fn(async (input: RegisterBindingInput) => {
      const record = makeRecord({ ...input.document, binding: input.binding })
      byId.set(record.id, record)
      return record
    }),
  }
}

const evidence = (
  overrides: Partial<FileOpenEvidence> & { canonicalPath: string },
): FileOpenEvidence => ({
  inode: null,
  contentHash: null,
  size: null,
  modifiedAt: 100,
  title: "File",
  manifestId: null,
  ...overrides,
})

function makePorts(overrides: Partial<OpenDocumentPorts> = {}): {
  ports: OpenDocumentPorts
  catalog: ReturnType<typeof fakeCatalog>
  registerExternalRoot: ReturnType<typeof vi.fn>
} {
  const catalog = (overrides.catalog as ReturnType<typeof fakeCatalog>) ?? fakeCatalog()
  const registerExternalRoot = vi.fn(
    async (input: { parentDir: string; filePath: string }): Promise<BindingRootMatch> => ({
      bindingRootId: "external-root",
      rootPath: input.parentDir,
      relativePath: "note.md",
    }),
  )
  let mintCounter = 0
  const ports: OpenDocumentPorts = {
    readFileEvidence: vi.fn(async ({ path }) => evidence({ canonicalPath: path })),
    locateBindingRoot: vi.fn(
      async (path: string): Promise<BindingRootLocation> => ({
        kind: "inside",
        match: { bindingRootId: "root-1", rootPath: "/root", relativePath: path.replace("/root/", "") },
      }),
    ),
    listKnownBindings: vi.fn(async () => []),
    mintId: () => `minted-${++mintCounter}`,
    ...overrides,
    catalog,
    registerExternalRoot,
  }
  return { ports, catalog, registerExternalRoot }
}

// ── id input ─────────────────────────────────────────────────────────────────

describe("openDocument — id input", () => {
  it("opens an existing local record", async () => {
    const catalog = fakeCatalog([makeRecord({ id: "doc-1" })])
    const { ports } = makePorts({ catalog })
    const open = createOpenDocumentUseCase(ports)
    const result = await open({ kind: "id", id: "doc-1" })
    expect(result).toMatchObject({ status: "opened", documentId: "doc-1", strategy: "existing" })
    // id resolves only through the catalog — the filesystem is never touched.
    expect(ports.readFileEvidence).not.toHaveBeenCalled()
    expect(ports.locateBindingRoot).not.toHaveBeenCalled()
  })

  it("returns orphaned when the id is unknown (never a draft)", async () => {
    const { ports } = makePorts()
    const open = createOpenDocumentUseCase(ports)
    const result = await open({ kind: "id", id: "missing" })
    expect(result).toEqual({ status: "orphaned", id: "missing" })
    expect(ports.catalog.registerBinding).not.toHaveBeenCalled()
  })

  it("surfaces conflict explicitly", async () => {
    const catalog = fakeCatalog([makeRecord({ id: "doc-1", syncStatus: "conflict" })])
    const { ports } = makePorts({ catalog })
    const open = createOpenDocumentUseCase(ports)
    const result = await open({ kind: "id", id: "doc-1" })
    expect(result).toMatchObject({ status: "conflict", documentId: "doc-1" })
  })

  it("fails cloud-only when materialization is not wired (never 'missing')", async () => {
    const catalog = fakeCatalog([
      makeRecord({ id: "cloud-1", localPresent: false, cloudPresent: true, syncStatus: "synced" }),
    ])
    const { ports } = makePorts({ catalog })
    const open = createOpenDocumentUseCase(ports)
    const result = await open({ kind: "id", id: "cloud-1" })
    expect(result.status).toBe("failed")
  })

  it("materializes cloud-only when the port is provided", async () => {
    const catalog = fakeCatalog([
      makeRecord({ id: "cloud-1", localPresent: false, cloudPresent: true, syncStatus: "synced" }),
    ])
    const materializeCloudOnly = vi.fn(async () =>
      makeRecord({ id: "cloud-1", localPresent: true, cloudPresent: true, syncStatus: "synced" }),
    )
    const { ports } = makePorts({ catalog, materializeCloudOnly })
    const open = createOpenDocumentUseCase(ports)
    const result = await open({ kind: "id", id: "cloud-1" })
    expect(materializeCloudOnly).toHaveBeenCalledWith({ documentId: "cloud-1" })
    expect(result).toMatchObject({ status: "opened", documentId: "cloud-1" })
  })
})

// ── path input ───────────────────────────────────────────────────────────────

describe("openDocument — path input", () => {
  it("is idempotent for an already-bound path (same UUID)", async () => {
    const catalog = fakeCatalog([
      makeRecord({
        id: "doc-1",
        binding: {
          documentId: "doc-1",
          bindingRootId: "root-1",
          relativePath: "a.md",
          canonicalPath: "/root/a.md",
          inode: 10,
          contentHash: "h",
          size: 1,
          lastSeenAt: 1,
        },
      }),
    ])
    const { ports } = makePorts({ catalog })
    const open = createOpenDocumentUseCase(ports)
    const result = await open({ kind: "path", path: "/root/a.md" })
    expect(result).toMatchObject({ status: "opened", documentId: "doc-1", strategy: "existing" })
    expect(ports.catalog.registerBinding).not.toHaveBeenCalled()
  })

  it("mints a UUID only after reconciliation for a brand-new file", async () => {
    const { ports, catalog } = makePorts()
    const open = createOpenDocumentUseCase(ports)
    const result = await open({ kind: "path", path: "/root/new.md" })
    expect(result).toMatchObject({ status: "opened", strategy: "minted", documentId: "minted-1" })
    expect(catalog.registerBinding).toHaveBeenCalledTimes(1)
  })

  it("prefers the durable manifest id over minting", async () => {
    const { ports } = makePorts({
      readFileEvidence: vi.fn(async ({ path }) =>
        evidence({ canonicalPath: path, manifestId: "manifest-uuid" }),
      ),
    })
    const open = createOpenDocumentUseCase(ports)
    const result = await open({ kind: "path", path: "/root/x.md" })
    expect(result).toMatchObject({ status: "opened", documentId: "manifest-uuid", strategy: "path" })
  })

  it("reuses the UUID by same relative path", async () => {
    const { ports } = makePorts({
      listKnownBindings: vi.fn(async () => [
        { documentId: "doc-path", bindingRootId: "root-1", relativePath: "x.md", inode: 5, contentHash: "h1" },
      ]),
    })
    const open = createOpenDocumentUseCase(ports)
    const result = await open({ kind: "path", path: "/root/x.md" })
    expect(result).toMatchObject({ status: "opened", documentId: "doc-path", strategy: "path" })
  })

  it("reuses the UUID by inode when the path changed", async () => {
    const { ports } = makePorts({
      readFileEvidence: vi.fn(async ({ path }) => evidence({ canonicalPath: path, inode: 42 })),
      listKnownBindings: vi.fn(async () => [
        { documentId: "doc-inode", bindingRootId: "root-1", relativePath: "old.md", inode: 42, contentHash: null },
      ]),
    })
    const open = createOpenDocumentUseCase(ports)
    const result = await open({ kind: "path", path: "/root/renamed.md" })
    expect(result).toMatchObject({ status: "opened", documentId: "doc-inode", strategy: "inode" })
  })

  it("reuses the UUID by unique local content hash", async () => {
    const { ports } = makePorts({
      readFileEvidence: vi.fn(async ({ path }) => evidence({ canonicalPath: path, contentHash: "same" })),
      listKnownBindings: vi.fn(async () => [
        { documentId: "doc-hash", bindingRootId: "root-1", relativePath: "gone.md", inode: null, contentHash: "same" },
      ]),
    })
    const open = createOpenDocumentUseCase(ports)
    const result = await open({ kind: "path", path: "/root/copy.md" })
    expect(result).toMatchObject({ status: "opened", documentId: "doc-hash", strategy: "local_hash" })
  })

  it("returns ambiguous (never auto-chooses) when a hash matches many", async () => {
    const { ports, catalog } = makePorts({
      readFileEvidence: vi.fn(async ({ path }) => evidence({ canonicalPath: path, contentHash: "dup" })),
      listKnownBindings: vi.fn(async () => [
        { documentId: "a", bindingRootId: "root-1", relativePath: "a.md", inode: null, contentHash: "dup" },
        { documentId: "b", bindingRootId: "root-1", relativePath: "b.md", inode: null, contentHash: "dup" },
      ]),
    })
    const open = createOpenDocumentUseCase(ports)
    const result = await open({ kind: "path", path: "/root/c.md" })
    expect(result.status).toBe("ambiguous")
    expect(result).toMatchObject({ candidates: expect.arrayContaining(["a", "b"]) })
    expect(catalog.registerBinding).not.toHaveBeenCalled()
  })
})

// ── BindingRoot confirmation ────────────────────────────────────────────────────

describe("openDocument — files outside a BindingRoot", () => {
  const outsidePorts = () =>
    makePorts({
      locateBindingRoot: vi.fn(
        async (): Promise<BindingRootLocation> => ({ kind: "outside", parentDir: "/Users/me/Notes" }),
      ),
    })

  it("asks for confirmation and registers nothing on the first pass", async () => {
    const { ports, catalog, registerExternalRoot } = outsidePorts()
    const open = createOpenDocumentUseCase(ports)
    const result = await open({ kind: "path", path: "/Users/me/Notes/note.md" })
    expect(result).toEqual({
      status: "needs-binding-root-confirmation",
      path: "/Users/me/Notes/note.md",
      parentDir: "/Users/me/Notes",
    })
    // Cancel path: no root, no UUID, no catalog record.
    expect(registerExternalRoot).not.toHaveBeenCalled()
    expect(catalog.registerBinding).not.toHaveBeenCalled()
  })

  it("registers the external root and opens once confirmed", async () => {
    const { ports, catalog, registerExternalRoot } = outsidePorts()
    const open = createOpenDocumentUseCase(ports)
    const result = await open({
      kind: "path",
      path: "/Users/me/Notes/note.md",
      confirmRegisterRoot: true,
    })
    expect(registerExternalRoot).toHaveBeenCalledWith({
      parentDir: "/Users/me/Notes",
      filePath: "/Users/me/Notes/note.md",
    })
    expect(result).toMatchObject({ status: "opened", strategy: "minted" })
    expect(catalog.registerBinding).toHaveBeenCalledTimes(1)
  })
})

// ── Failure never fabricates identity ───────────────────────────────────────────

describe("openDocument — failures never mint or draft", () => {
  it("returns failed when the file cannot be read and mints nothing", async () => {
    const { ports, catalog } = makePorts({
      readFileEvidence: vi.fn(async () => {
        throw new Error("EACCES")
      }),
    })
    const open = createOpenDocumentUseCase(ports)
    const result = await open({ kind: "path", path: "/root/locked.md" })
    expect(result).toEqual({ status: "failed", reason: "EACCES" })
    expect(catalog.registerBinding).not.toHaveBeenCalled()
  })

  it("reopening the same new path yields the same UUID", async () => {
    const { ports } = makePorts()
    const open = createOpenDocumentUseCase(ports)
    const first = await open({ kind: "path", path: "/root/dup.md" })
    const second = await open({ kind: "path", path: "/root/dup.md" })
    expect(first.status).toBe("opened")
    expect(second.status).toBe("opened")
    expect(first).toMatchObject({ documentId: "minted-1" })
    // Second open resolves through the catalog binding written by the first.
    expect(second).toMatchObject({ documentId: "minted-1", strategy: "existing" })
  })
})
