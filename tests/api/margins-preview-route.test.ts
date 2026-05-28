import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "@/app/api/margins/preview/route"

const previewLookupMock = vi.hoisted(() => vi.fn())
const adminFromMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/sharing/test-link-access", () => ({
  getPreviewWritingFromTestLink: previewLookupMock,
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: adminFromMock,
  })),
}))

function createSelectChain(result: { data: unknown; error: unknown }) {
  return {
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(async () => result),
      })),
    })),
  }
}

describe("GET /api/margins/preview", () => {
  beforeEach(() => {
    previewLookupMock.mockReset()
    adminFromMock.mockReset()
    delete process.env.ODE_TEST_LINK_FIXTURES
  })

  it("falls back to the legacy margins schema when preview columns are not deployed", async () => {
    previewLookupMock.mockResolvedValue({
      state: "ok",
      writing: { id: "writing-1" },
    })

    const missingColumnsError = {
      message: 'column margins.type does not exist',
      details: 'Could not find the type column on public.margins',
    }

    adminFromMock.mockImplementation(() => ({
      select: vi.fn((query: string) => {
        if (query.includes("type, text")) {
          return createSelectChain({ data: null, error: missingColumnsError })
        }

        if (query.includes("anchor_text, note, shared")) {
          return createSelectChain({
            data: [
              {
                id: "margin-1",
                writing_id: "writing-1",
                anchor_start: 0,
                anchor_end: 7,
                anchor_text: "Preview",
                note: "Legacy preview note",
                shared: true,
                shared_at: "2026-05-28T00:00:00.000Z",
                created_at: "2026-05-28T00:00:00.000Z",
                updated_at: "2026-05-28T00:00:00.000Z",
              },
            ],
            error: null,
          })
        }

        throw new Error(`Unexpected select query: ${query}`)
      }),
    }))

    const response = await GET(new Request("https://app.odessay.com/api/margins/preview?token=previewtokenlegacy123"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.error).toBeNull()
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "margin-1",
        type: "personal",
        text: "Legacy preview note",
        note: "Legacy preview note",
        archived: false,
        resolved: false,
      }),
    ])
  })
})
