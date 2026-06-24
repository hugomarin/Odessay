import { describe, expect, it } from "vitest"
import {
  filenameToTitle,
  resolveUniqueFilename,
  titleToFilename,
} from "@/lib/desktop/document-naming"

describe("document-naming", () => {
  describe("filenameToTitle", () => {
    it("returns the filename stem verbatim", () => {
      expect(filenameToTitle("Mi Nota.md")).toBe("Mi Nota")
      expect(filenameToTitle("my-writing-file.md")).toBe("my-writing-file")
      expect(filenameToTitle("Acentuación y Espacios.md")).toBe("Acentuación y Espacios")
    })

    it("strips only the .md extension", () => {
      expect(filenameToTitle("note.md")).toBe("note")
      expect(filenameToTitle("/path/to/My Note.md")).toBe("My Note")
      expect(filenameToTitle("C:\\\\notes\\\\My Note.md")).toBe("My Note")
    })
  })

  describe("titleToFilename", () => {
    it("preserves case, accents and spaces", () => {
      expect(titleToFilename("Mi Nota")).toBe("Mi Nota.md")
      expect(titleToFilename("Acentuación")).toBe("Acentuación.md")
    })

    it("sanitises filesystem-illegal characters", () => {
      expect(titleToFilename("Mi/Nota")).toBe("MiNota.md")
      expect(titleToFilename("Mi\\Nota")).toBe("MiNota.md")
      expect(titleToFilename("Mi:Nota")).toBe("MiNota.md")
      expect(titleToFilename('Mi?"<>|Nota')).toBe("MiNota.md")
    })

    it("falls back to Untitled for empty or whitespace-only titles", () => {
      expect(titleToFilename("")).toBe("Untitled.md")
      expect(titleToFilename("   ")).toBe("Untitled.md")
    })
  })

  describe("resolveUniqueFilename", () => {
    it("returns the desired filename when no collision exists", () => {
      expect(resolveUniqueFilename("Mi Nota.md", ["Otra.md"])).toBe("Mi Nota.md")
    })

    it("appends a counter on collision", () => {
      expect(resolveUniqueFilename("Mi Nota.md", ["Mi Nota.md"])).toBe("Mi Nota 2.md")
      expect(
        resolveUniqueFilename("Mi Nota.md", ["Mi Nota.md", "Mi Nota 2.md"]),
      ).toBe("Mi Nota 3.md")
    })

    it("is case-insensitive to match macOS/Windows filesystems", () => {
      expect(resolveUniqueFilename("Mi Nota.md", ["mi nota.md"])).toBe("Mi Nota 2.md")
    })
  })
})
