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
type QueryResult = { data: Row[] | Row | null; error: null }
type QueryKind = "select" | "update" | "insert" | "upsert" | "delete"
type Filter = (row: Row) => boolean

class MemorySupabase {
  private readonly tables = new Map<string, Map<string, Row>>()

  seed(table: string, row: Row) {
    this.table(table).set(String(row.id), structuredClone(row))
  }

  row(table: string, id: string) {
    const row = this.tables.get(table)?.get(id)
    return row ? structuredClone(row) : null
  }

  from(table: string) {
    return {
      select: () => this.query(table, "select"),
      update: (payload: Row) => this.query(table, "update", payload),
      insert: (payload: Row | Row[]) => this.query(table, "insert", payload),
      upsert: (payload: Row | Row[]) => this.query(table, "upsert", payload),
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

  execute(tableName: string, kind: QueryKind, payload: Row | Row[] | undefined, filters: Filter[], single: boolean): QueryResult {
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
    return Promise.resolve(this.run(true))
  }

  single() {
    return Promise.resolve(this.run(true))
  }

  private run(single = this.singleResult) {
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
  return PATCH(
    new Request(`http://localhost/api/writings/${WRITING_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body_json: bodyJson,
        body_text: bodyText,
        version: 2,
        updated_at: "2026-10-07T12:00:00.000Z",
      }),
    }),
    { params: Promise.resolve({ id: WRITING_ID }) },
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
  const malformedSource =
    '<Annotation id="collaborative-sentinel-531" type="personal" comment="Keep this collaborative note" extra="invalid">Anchor</Annotation>'

  it("conserves the collaborative margin after invalid Annotation source becomes opaque Rich content", async () => {
    const snapshot = parseMarkdownToSnapshot(malformedSource)
    const opaqueNodes: JSONContent[] = []
    visitJsonNodes(snapshot.bodyJson, (node) => {
      if (node.type === OPAQUE_SOURCE_INLINE_NODE || node.type === OPAQUE_SOURCE_BLOCK_NODE) {
        opaqueNodes.push(node)
      }
    })

    expect(opaqueNodes).toHaveLength(1)
    expect(opaqueNodes[0]?.attrs).toEqual(
      expect.objectContaining({ raw: malformedSource, reason: "invalid-attributes" }),
    )
    seedMargin(collaborativeMargin(SENTINEL_ID))

    const response = await saveBody(snapshot.bodyJson, snapshot.bodyText)
    expect(response.status).toBe(200)
    expect(database.row("margins", SENTINEL_ID)).toEqual(
      expect.objectContaining({ id: SENTINEL_ID, shared: true, resolved: false }),
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
})
