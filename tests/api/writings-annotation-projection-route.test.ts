/**
 * @vitest-environment happy-dom
 */
import { Editor, type JSONContent } from "@tiptap/core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PATCH } from "@/app/api/writings/[id]/route"
import { createEditorExtensions } from "@/lib/editor/extensions"
import { parseMarkdownToSnapshot } from "@/lib/editor/document-serialization"
import { OPAQUE_SOURCE_BLOCK_NODE, OPAQUE_SOURCE_INLINE_NODE } from "@/lib/editor/opaque-source-extensions"

const getCurrentUserFromRequestMock = vi.hoisted(() => vi.fn())
const supabaseAdminMock = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: getCurrentUserFromRequestMock,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => supabaseAdminMock,
}))

type Row = Record<string, unknown>
type DatabaseError = { code?: string; message: string }
type QueryResult = { data: Row[] | Row | null; error: DatabaseError | null }
type QueryKind = "select" | "update" | "insert" | "upsert" | "delete"
type Filter = (row: Row) => boolean

class MemorySupabase {
  private readonly tables = new Map<string, Map<string, Row>>()
  private readonly failures = new Map<string, DatabaseError>()
  private marginUpsertHold: {
    started: () => void
    released: Promise<void>
  } | null = null

  seed(table: string, row: Row) {
    this.table(table).set(String(row.id), structuredClone(row))
  }

  row(table: string, id: string) {
    const row = this.tables.get(table)?.get(id)
    return row ? structuredClone(row) : null
  }

  failNext(table: string, kind: QueryKind, error: DatabaseError) {
    this.failures.set(`${table}:${kind}`, error)
  }

  holdNextMarginUpsert() {
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    this.marginUpsertHold = { started: markStarted, released }
    return { started, release }
  }

  from(table: string) {
    return {
      select: () => this.query(table, "select"),
      update: (payload: Row) => this.query(table, "update", payload),
      insert: (payload: Row | Row[]) => this.query(table, "insert", payload),
      upsert: (payload: Row | Row[], _options?: { onConflict?: string }) => this.query(table, "upsert", payload),
      delete: () => this.query(table, "delete"),
    }
  }

  private query(table: string, kind: QueryKind, payload?: Row | Row[]) {
    return new MemoryQuery(this, table, kind, payload)
  }

  private table(name: string) {
    let table = this.tables.get(name)
    if (!table) {
      table = new Map()
      this.tables.set(name, table)
    }
    return table
  }

  async execute(
    tableName: string,
    kind: QueryKind,
    payload: Row | Row[] | undefined,
    filters: Filter[],
    single: boolean,
  ): Promise<QueryResult> {
    if (tableName === "margins" && kind === "upsert" && this.marginUpsertHold) {
      const hold = this.marginUpsertHold
      this.marginUpsertHold = null
      hold.started()
      await hold.released
    }

    const failure = this.failures.get(`${tableName}:${kind}`)
    if (failure) {
      this.failures.delete(`${tableName}:${kind}`)
      return { data: null, error: failure }
    }

    const table = this.table(tableName)
    const rows = Array.from(table.values()).filter((row) => filters.every((filter) => filter(row)))
    let affected: Row[] = rows

    if (kind === "update") {
      affected = rows.map((row) => {
        const updated = { ...row, ...(payload as Row) }
        table.set(String(updated.id), updated)
        return updated
      })
    } else if (kind === "insert" || kind === "upsert") {
      const incoming = Array.isArray(payload) ? payload : payload ? [payload] : []
      affected = incoming.map((row) => {
        const id = String(row.id)
        const next = kind === "upsert" ? { ...table.get(id), ...row } : row
        table.set(id, structuredClone(next))
        return next
      })
    } else if (kind === "delete") {
      for (const row of rows) table.delete(String(row.id))
      affected = rows
    }

    return { data: single ? affected[0] ?? null : affected.map((row) => structuredClone(row)), error: null }
  }
}

class MemoryQuery implements PromiseLike<QueryResult> {
  private readonly filters: Filter[] = []
  private singleResult = false

  constructor(
    private readonly database: MemorySupabase,
    private readonly table: string,
    private readonly kind: QueryKind,
    private readonly payload?: Row | Row[],
  ) {}

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === "in" && typeof value === "string") {
      const ids = new Set(value.replace(/^\(|\)$/g, "").split(","))
      this.filters.push((row) => !ids.has(String(row[column])))
    }
    return this
  }

  order() {
    return this
  }

  select() {
    return this
  }

  maybeSingle() {
    return this.run(true)
  }

  single() {
    return this.run(true)
  }

  private run(single = this.singleResult): Promise<QueryResult> {
    return this.database.execute(this.table, this.kind, this.payload, this.filters, single)
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected)
  }
}

const WRITING_ID = "writing-531"
const READER_ID = "reader-531"
const SENTINEL_ID = "collaborative-sentinel-531"
const NESTED_CONTROL_ID = "nested-card-tip-control-531"

let database: MemorySupabase

const collaborativeMargin = (id: string): Row => ({
  id,
  writing_id: WRITING_ID,
  reader_id: READER_ID,
  anchor_start: 0,
  anchor_end: 6,
  anchor_text: "Anchor",
  type: "collaborative",
  text: "Keep this collaborative note",
  note: "Keep this collaborative note",
  shared: true,
  shared_at: "2026-10-07T00:00:00.000Z",
  archived: false,
  resolved: false,
  created_at: "2026-10-07T00:00:00.000Z",
  updated_at: "2026-10-07T00:00:00.000Z",
})

function seedWriting() {
  database.seed("writings", {
    id: WRITING_ID,
    author_id: READER_ID,
    title: "Annotation projection",
    status: "draft",
    artifact_type: "general",
    visibility: "private",
    version: 1,
  })
}

function seedMargin(row: Row) {
  database.seed("margins", row)
}

async function saveBody(bodyJson: JSONContent, bodyText: string) {
  return saveBodyFor(WRITING_ID, bodyJson, bodyText)
}

async function saveBodyFor(writingId: string, bodyJson: JSONContent, bodyText: string) {
  return PATCH(
    new Request(`http://localhost/api/writings/${writingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body_json: bodyJson,
        body_text: bodyText,
        version: 2,
        updated_at: "2026-10-07T12:00:00.000Z",
      }),
    }),
    { params: Promise.resolve({ id: writingId }) },
  )
}

function visitJsonNodes(value: JSONContent, visit: (node: JSONContent) => void) {
  visit(value)
  for (const child of value.content ?? []) visitJsonNodes(child, visit)
}

beforeEach(() => {
  database = new MemorySupabase()
  supabaseAdminMock.from.mockImplementation((table: string) => database.from(table))
  getCurrentUserFromRequestMock.mockReset().mockResolvedValue({ userId: READER_ID })
  seedWriting()
})

describe("PATCH /api/writings/[id] annotation projection", () => {
  const malformedAnnotation =
    `<Annotation id="${SENTINEL_ID}" type="personal" comment="Keep this collaborative note" extra="invalid">Anchor</Annotation>`
  const validNestedAnnotation =
    `<Annotation id="${NESTED_CONTROL_ID}" type="personal" comment="N687 nested positive control">Tip control</Annotation>`
  const malformedSource = [
    `<Card title="N687 invalid collaborative Annotation">\n${malformedAnnotation}\n</Card>`,
    `<Tip title="N687 valid nested control">\n${validNestedAnnotation}\n</Tip>`,
  ].join("\n\n")

  it("keeps nested Card/Tip margin rows when an invalid Annotation becomes opaque Rich content", async () => {
    const snapshot = parseMarkdownToSnapshot(malformedSource)
    const opaqueNodes: JSONContent[] = []
    visitJsonNodes(snapshot.bodyJson, (node) => {
      if (node.type === OPAQUE_SOURCE_INLINE_NODE || node.type === OPAQUE_SOURCE_BLOCK_NODE) {
        opaqueNodes.push(node)
      }
    })

    expect(opaqueNodes).toHaveLength(1)
    expect(opaqueNodes[0]?.attrs).toEqual(
      expect.objectContaining({ raw: malformedAnnotation, reason: "invalid-attributes" }),
    )
    expect(malformedSource, "control positivo: el source contiene el sentinel colaborativo").toContain(
      "Keep this collaborative note",
    )
    seedMargin(collaborativeMargin(SENTINEL_ID))

    const response = await saveBody(snapshot.bodyJson, snapshot.bodyText)
    expect(response.status).toBe(200)
    expect(database.row("margins", SENTINEL_ID)).toEqual(
      expect.objectContaining({ id: SENTINEL_ID, shared: true, resolved: false }),
    )
    expect(database.row("margins", NESTED_CONTROL_ID)).toEqual(
      expect.objectContaining({
        id: NESTED_CONTROL_ID,
        writing_id: WRITING_ID,
        reader_id: READER_ID,
        type: "personal",
        text: "N687 nested positive control",
        note: "N687 nested positive control",
        anchor_text: "Tip control",
      }),
    )
  })

  it("removes the margin after an accepted Annotation is explicitly deleted in Rich", async () => {
    const markdown = '<Annotation id="annotation-to-delete-531" type="personal" comment="Remove me">Anchor</Annotation>'
    const snapshot = parseMarkdownToSnapshot(markdown)
    const editor = new Editor({ extensions: createEditorExtensions(), content: snapshot.bodyJson })
    seedMargin({ ...collaborativeMargin("annotation-to-delete-531"), type: "personal" })

    try {
      expect(editor.commands.deleteAnnotation("personal", 1, "annotation-to-delete-531")).toBe(true)
      const response = await saveBody(editor.getJSON(), editor.getText({ blockSeparator: "\n" }))

      expect(response.status).toBe(200)
      expect(database.row("margins", "annotation-to-delete-531")).toBeNull()
    } finally {
      editor.destroy()
    }
  })

  it("keeps the writing content after an annotation upsert fails and leaves margins unconfirmed", async () => {
    const markdown = '<Annotation id="annotation-upsert-failure-531" type="personal" comment="Keep source">Anchor</Annotation>'
    const snapshot = parseMarkdownToSnapshot(markdown)
    const sentinel = collaborativeMargin(SENTINEL_ID)
    seedMargin(sentinel)
    database.failNext("margins", "upsert", { message: "margin upsert unavailable" })
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      const response = await saveBody(snapshot.bodyJson, snapshot.bodyText)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.data.body_json).toEqual(snapshot.bodyJson)
      expect(database.row("writings", WRITING_ID)?.body_json).toEqual(snapshot.bodyJson)
      expect(database.row("margins", SENTINEL_ID)).toEqual(sentinel)
      expect(database.row("margins", "annotation-upsert-failure-531")).toBeNull()
      expect(payload.data).not.toHaveProperty("margins")
      expect(errors).toHaveBeenCalledWith(
        "[writings:patch:sync-margins]",
        expect.objectContaining({ writingId: WRITING_ID, userId: READER_ID, error: "Unknown error" }),
      )
    } finally {
      errors.mockRestore()
    }
  })

  it("keeps the writing content and existing row after a margin delete fails", async () => {
    const markdown = '<Annotation id="annotation-delete-failure-531" type="personal" comment="Remove me">Anchor</Annotation>'
    const snapshot = parseMarkdownToSnapshot(markdown)
    const editor = new Editor({ extensions: createEditorExtensions(), content: snapshot.bodyJson })
    const margin = { ...collaborativeMargin("annotation-delete-failure-531"), type: "personal" }
    seedMargin(margin)
    expect(editor.commands.deleteAnnotation("personal", 1, "annotation-delete-failure-531")).toBe(true)
    const savedBody = editor.getJSON()
    const savedText = editor.getText({ blockSeparator: "\n" })
    database.failNext("margins", "delete", { message: "margin delete unavailable" })
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      const response = await saveBody(savedBody, savedText)
      const payload = await response.json()

      expect(response.status).toBe(200)
      expect(payload.data.body_json).toEqual(savedBody)
      expect(database.row("writings", WRITING_ID)?.body_json).toEqual(savedBody)
      expect(database.row("margins", "annotation-delete-failure-531")).toEqual(margin)
      expect(payload.data).not.toHaveProperty("margins")
      expect(errors).toHaveBeenCalledWith(
        "[writings:patch:sync-margins]",
        expect.objectContaining({ writingId: WRITING_ID, userId: READER_ID, error: "Unknown error" }),
      )
    } finally {
      errors.mockRestore()
      editor.destroy()
    }
  })

  it("keeps A's late margin projection scoped to A while B saves", async () => {
    const writingA = "writing-531-a"
    const writingB = "writing-531-b"
    const snapshotA = parseMarkdownToSnapshot(
      '<Annotation id="annotation-a-531" type="personal" comment="A">Anchor A</Annotation>',
    )
    const snapshotB = parseMarkdownToSnapshot(
      '<Annotation id="annotation-b-531" type="personal" comment="B">Anchor B</Annotation>',
    )
    seedWritingFor(writingA)
    seedWritingFor(writingB)
    const hold = database.holdNextMarginUpsert()
    const saveA = saveBodyFor(writingA, snapshotA.bodyJson, snapshotA.bodyText)

    try {
      await hold.started
      expect(database.row("writings", writingA)?.body_json).toEqual(snapshotA.bodyJson)

      const responseB = await saveBodyFor(writingB, snapshotB.bodyJson, snapshotB.bodyText)
      const payloadB = await responseB.json()
      const marginB = database.row("margins", "annotation-b-531")

      expect(responseB.status).toBe(200)
      expect(payloadB.data.body_json).toEqual(snapshotB.bodyJson)
      expect(marginB).toEqual(expect.objectContaining({ id: "annotation-b-531", writing_id: writingB }))

      hold.release()
      const responseA = await saveA
      const payloadA = await responseA.json()

      expect(responseA.status).toBe(200)
      expect(payloadA.data.body_json).toEqual(snapshotA.bodyJson)
      expect(database.row("margins", "annotation-a-531")).toEqual(
        expect.objectContaining({ id: "annotation-a-531", writing_id: writingA }),
      )
      expect(database.row("margins", "annotation-b-531")).toEqual(marginB)
    } finally {
      hold.release()
      await saveA.catch(() => undefined)
    }
  })
})

function seedWritingFor(writingId: string) {
  database.seed("writings", {
    id: writingId,
    author_id: READER_ID,
    title: "Annotation projection",
    status: "draft",
    artifact_type: "general",
    visibility: "private",
    version: 1,
  })
}
