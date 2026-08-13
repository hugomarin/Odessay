import { describe, expect, it } from "vitest"
import { DOCX_MIME_TYPE, getDialogFilterName } from "@/lib/services/desktop/export-delivery"

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
