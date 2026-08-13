import { describe, expect, it } from "vitest"
import {
  filenameToTitle,
  resolveUniqueFilename,
  splitCanonicalPath,
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
      expect(titleToFilename("Test de salvadode Archivo con Nombre propio", "")).toBe(
        "Test de salvadode Archivo con Nombre propio",
      )
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

  describe("splitCanonicalPath", () => {
    it("splits POSIX paths into root and relative segments", () => {
      expect(splitCanonicalPath("/home/user/Documents/Carta.md")).toEqual({
        rootPath: "/home/user/Documents",
        relativePath: "Carta.md",
      })
    })

    it("splits Windows paths into root and relative segments", () => {
      expect(splitCanonicalPath("C:\\Users\\user\\Documents\\Carta.md")).toEqual({
        rootPath: "C:\\Users\\user\\Documents",
        relativePath: "Carta.md",
      })
    })

    it("returns a sentinel root for a bare filename", () => {
      expect(splitCanonicalPath("Carta.md")).toEqual({
        rootPath: ".",
        relativePath: "Carta.md",
      })
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
