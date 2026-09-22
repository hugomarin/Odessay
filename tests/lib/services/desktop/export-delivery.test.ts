/**
 * EXP-05 — dialog cancel / write failure, real fs.
 *
 * `saveDesktopBinaryExport` is the real, unmodified production code under
 * test: real `@tauri-apps/plugin-dialog`.save() (faked — a native OS dialog
 * cannot run in Vitest) feeds a real `tauriWriteBinaryFile` call, which this
 * suite doubles with a real fs write (mkdir parents, write tmp, rename —
 * mirroring the actual Rust `write_binary_file` command) against a real temp
 * directory. Only the native dialog and the Tauri IPC decode step are
 * faked; the write itself, and any failure it produces, is genuine.
 *
 * See workflow/quality/capability-integration-map.md (EXP-05). Paired with
 * tests/components/properties-panel-export.test.tsx, which proves the UI
 * reaction to what this layer reports.
 */
import { promises as fs } from "node:fs"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const saveDialogMock = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: saveDialogMock,
}))

// Mirrors the real Rust `write_binary_file` command (src-tauri/src/commands/document.rs):
// create missing parent dirs, write a `.tmp` sibling, then rename over the
// target. A real fs write, not a scripted throw — so a "write failure" here
// (e.g. a parent path component that is actually a file, not a directory)
// is a genuine fs error, the same shape the real command would surface.
async function tauriWriteBinaryFileDouble(path: string, bytes: Uint8Array): Promise<void> {
  const parent = dirname(path)
  await fs.mkdir(parent, { recursive: true })
  const tmpPath = `${path}.tmp`
  await fs.writeFile(tmpPath, bytes)
  await fs.rename(tmpPath, path)
}

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriWriteBinaryFile: (path: string, bytes: Uint8Array) => tauriWriteBinaryFileDouble(path, bytes),
}))

const { DOCX_MIME_TYPE, getDialogFilterName, saveDesktopBinaryExport } = await import(
  "@/lib/services/desktop/export-delivery"
)

describe("export-delivery", () => {
  describe("getDialogFilterName", () => {
    it("detects DOCX from MIME when no extension is present", () => {
      expect(getDialogFilterName(DOCX_MIME_TYPE, null)).toBe("Word Document")
    })

    it("detects DOCX from file extension when MIME is unrelated", () => {
      expect(getDialogFilterName("application/octet-stream", "docx")).toBe("Word Document")
    })

    it("detects PDF from MIME or extension", () => {
      expect(getDialogFilterName("application/pdf", null)).toBe("PDF")
      expect(getDialogFilterName("application/octet-stream", "pdf")).toBe("PDF")
    })

    it("falls back to a generic export label for unknown formats", () => {
      expect(getDialogFilterName("application/rtf", "rtf")).toBe("Export")
    })
  })
})

describe("saveDesktopBinaryExport (real fs)", () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "odessay-export-delivery-"))
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  afterEach(() => {
    saveDialogMock.mockReset()
  })

  const artifact = {
    bytes: new TextEncoder().encode("%PDF-1.4 fake artifact bytes"),
    fileName: "letter.pdf",
    mimeType: "application/pdf",
  }

  it("returns false and writes nothing when the dialog is canceled", async () => {
    saveDialogMock.mockResolvedValue(null)

    const result = await saveDesktopBinaryExport(artifact)

    expect(result).toBe(false)
    const target = join(root, "cancel-check.pdf")
    await expect(fs.access(target)).rejects.toThrow()
  })

  it("returns true and the exact bytes land on disk when the write succeeds", async () => {
    const target = join(root, "success", "letter.pdf")
    saveDialogMock.mockResolvedValue(target)

    const result = await saveDesktopBinaryExport(artifact)

    expect(result).toBe(true)
    const written = await fs.readFile(target)
    expect(new Uint8Array(written)).toEqual(artifact.bytes)
  })

  it("propagates a real fs write failure instead of reporting success", async () => {
    // A parent path component that is a plain file (not a directory) makes
    // a real, deterministic, cross-platform mkdir/write failure — the same
    // class of error `write_binary_file` itself would surface (disk full,
    // permission denied, etc.), without needing a scripted throw.
    const blockerFile = join(root, "not-a-directory")
    await fs.writeFile(blockerFile, "occupied")
    const target = join(blockerFile, "letter.pdf")
    saveDialogMock.mockResolvedValue(target)

    await expect(saveDesktopBinaryExport(artifact)).rejects.toThrow()
  })
})
