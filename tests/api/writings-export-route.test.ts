import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "@/app/api/writings/[id]/export/route"

const getCurrentUserFromRequestMock = vi.hoisted(() => vi.fn())

const supabaseAdminMock = vi.hoisted(() => ({
  from: vi.fn() as any,
}))

vi.mock("@/lib/supabase/request-auth", () => ({
  getCurrentUserFromRequest: getCurrentUserFromRequestMock,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => supabaseAdminMock),
}))

vi.mock("@/lib/export/to-pdf", () => ({
  renderWritingToPdfBuffer: vi.fn(async () => Buffer.from("pdf-content")),
}))

vi.mock("@/lib/export/to-docx", () => ({
  renderWritingToDocxBuffer: vi.fn(async () => Buffer.from("docx-content")),
}))

describe("GET /api/writings/[id]/export", () => {
  beforeEach(() => {
    getCurrentUserFromRequestMock.mockReset()
    supabaseAdminMock.from.mockReset()
  })

  const mockWriting = (overrides?: Partial<Record<string, unknown>>) => ({
    id: "123e4567-e89b-12d3-a456-426614174000",
    author_id: "user-1",
    title: "Hello World",
    body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }] },
    body_text: "Body",
    deleted_at: null,
    ...overrides,
  })

  const mockRequest = (format: string) =>
    new Request(`http://localhost/api/writings/123e4567-e89b-12d3-a456-426614174000/export?format=${format}`)

  const mockContext = () => ({
    params: Promise.resolve({ id: "123e4567-e89b-12d3-a456-426614174000" }),
  })

  it("returns 401 when there is no active session", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: null })

    const response = await GET(mockRequest("pdf"), mockContext())
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.code).toBe("UNAUTHORIZED")
  })

  it("returns Content-Disposition with RFC 5987 encoding for Unicode filenames (PDF)", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: "user-1" })

    supabaseAdminMock.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({
            data: mockWriting({ title: "Hello — World" }),
            error: null,
          })),
        })),
      })),
    })

    const response = await GET(mockRequest("pdf"), mockContext())

    expect(response.status).toBe(200)
    const disposition = response.headers.get("Content-Disposition")
    expect(disposition).toContain('filename="Hello-World.pdf"')
    expect(disposition).toContain("filename*=UTF-8''Hello-%E2%80%94-World.pdf")
  })

  it("returns Content-Disposition with RFC 5987 encoding for Unicode filenames (DOCX)", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: "user-1" })

    supabaseAdminMock.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({
            data: mockWriting({ title: "Café résumé — draft" }),
            error: null,
          })),
        })),
      })),
    })

    const response = await GET(mockRequest("docx"), mockContext())

    expect(response.status).toBe(200)
    const disposition = response.headers.get("Content-Disposition")
    expect(disposition).toContain('filename="Cafe-resume-draft.docx"')
    expect(disposition).toContain("filename*=UTF-8''Cafe-resume-%E2%80%94-draft.docx")
  })

  it("returns a safe fallback filename when title is all non-ASCII", async () => {
    getCurrentUserFromRequestMock.mockResolvedValue({ userId: "user-1" })

    supabaseAdminMock.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({
            data: mockWriting({ title: "———", body_text: "body content" }),
            error: null,
          })),
        })),
      })),
    })

    const response = await GET(mockRequest("pdf"), mockContext())

    expect(response.status).toBe(200)
    const disposition = response.headers.get("Content-Disposition")
    expect(disposition).toContain('filename="export.pdf"')
    expect(disposition).toContain("filename*=UTF-8''%E2%80%94%E2%80%94%E2%80%94.pdf")
  })
})
