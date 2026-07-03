/**
 * @vitest-environment happy-dom
 */
import { readFileSync, readdirSync } from "node:fs"
import { basename, join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { parseDocumentFileToSnapshot } from "@/lib/editor/document-serialization"
import { renderWritingBodyHtml as renderClientWritingBodyHtml } from "@/lib/reading/render-body-html-client"
import { renderWritingBodyHtml as renderServerWritingBodyHtml } from "@/lib/reading/render-body-html"

const FIXTURE_DIR = join(process.cwd(), "tests/parity/fixtures")
const GOLDEN_DIR = join(process.cwd(), "tests/parity/golden")
const fixtureNames = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".md")).sort()

const normalizeHtml = (html: string) =>
  html
    .replaceAll(/\s+xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, "")
    .replaceAll(/\s*\/>/g, ">")
    .replaceAll(/\s+data-id="[^"]+"/g, "")
    .replaceAll(/\s+data-annotation-id="[^"]+"/g, "")
    .replaceAll(/\s+/g, " ")
    .replaceAll("> <", "><")
    .trim()

describe("canonical markdown render parity", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
    })
  })

  it.each(fixtureNames)("%s renders the same HTML in server and client adapters", (fixtureName) => {
    const source = readFileSync(join(FIXTURE_DIR, fixtureName), "utf8")
    const snapshot = parseDocumentFileToSnapshot(source).snapshot

    const server = renderServerWritingBodyHtml(snapshot.bodyJson, snapshot.bodyText)
    const client = renderClientWritingBodyHtml(snapshot.bodyJson, snapshot.bodyText)

    expect(server.mode).toBe("rich")
    expect(client.mode).toBe("rich")
    expect(normalizeHtml(client.bodyHtml)).toBe(normalizeHtml(server.bodyHtml))
  })

  it.each(fixtureNames)("%s matches its structural golden output", (fixtureName) => {
    const source = readFileSync(join(FIXTURE_DIR, fixtureName), "utf8")
    const snapshot = parseDocumentFileToSnapshot(source).snapshot
    const actual = renderServerWritingBodyHtml(snapshot.bodyJson, snapshot.bodyText)
    const goldenName = `${basename(fixtureName, ".md")}.html`
    const expected = readFileSync(join(GOLDEN_DIR, goldenName), "utf8")

    expect(normalizeHtml(actual.bodyHtml)).toBe(normalizeHtml(expected))
  })

  it("keeps wide table containment in the shared render contract", () => {
    const source = readFileSync(join(FIXTURE_DIR, "core-profile.md"), "utf8")
    const snapshot = parseDocumentFileToSnapshot(source).snapshot
    const rendered = renderServerWritingBodyHtml(snapshot.bodyJson, snapshot.bodyText)

    expect(rendered.bodyHtml).toContain('class="odessay-table-wrap prose-odessay-table-wrap"')
  })
})
