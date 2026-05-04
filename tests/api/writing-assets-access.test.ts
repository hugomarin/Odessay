import { describe, expect, it } from "vitest"

function canAccessAsset({
  visibility,
  authorId,
  viewerId,
  isSharedWithViewer,
}: {
  visibility: "private" | "shared" | "public"
  authorId: string
  viewerId: string | null
  isSharedWithViewer: boolean
}) {
  if (visibility === "public") return true
  if (authorId === viewerId) return true
  if (visibility === "shared" && viewerId && isSharedWithViewer) return true
  return false
}

describe("writing asset access control", () => {
  const authorId = "author-1"
  const viewerId = "viewer-1"
  const strangerId = "stranger-1"

  it("allows author to access private asset", () => {
    expect(
      canAccessAsset({ visibility: "private", authorId, viewerId: authorId, isSharedWithViewer: false }),
    ).toBe(true)
  })

  it("denies stranger from accessing private asset", () => {
    expect(
      canAccessAsset({ visibility: "private", authorId, viewerId: strangerId, isSharedWithViewer: false }),
    ).toBe(false)
  })

  it("denies unauthenticated user from accessing private asset", () => {
    expect(
      canAccessAsset({ visibility: "private", authorId, viewerId: null, isSharedWithViewer: false }),
    ).toBe(false)
  })

  it("allows shared recipient to access shared asset", () => {
    expect(
      canAccessAsset({ visibility: "shared", authorId, viewerId, isSharedWithViewer: true }),
    ).toBe(true)
  })

  it("denies non-recipient from accessing shared asset", () => {
    expect(
      canAccessAsset({ visibility: "shared", authorId, viewerId: strangerId, isSharedWithViewer: false }),
    ).toBe(false)
  })

  it("denies unauthenticated user from accessing shared asset", () => {
    expect(
      canAccessAsset({ visibility: "shared", authorId, viewerId: null, isSharedWithViewer: false }),
    ).toBe(false)
  })

  it("allows anyone to access public asset", () => {
    expect(
      canAccessAsset({ visibility: "public", authorId, viewerId: strangerId, isSharedWithViewer: false }),
    ).toBe(true)
  })

  it("allows unauthenticated user to access public asset", () => {
    expect(
      canAccessAsset({ visibility: "public", authorId, viewerId: null, isSharedWithViewer: false }),
    ).toBe(true)
  })
})
