/**
 * Deliberately its own module, not exported from tauri-commands.ts: that
 * module gets `vi.mock`-replaced wholesale in every desktop integration test
 * (real-desktop-doubles.ts stands in for it), and a mocked module's factory
 * only carries the specific exports it lists — a class living there would
 * become undefined for every consumer that still needs the real class to do
 * `instanceof` checks against a thrown value from the double. Both the real
 * `tauriWriteFile` and its real behavioral double (`tauriWriteFileDouble`)
 * throw this same class so `FilesystemDocumentService.saveWriting`'s
 * `instanceof` check works identically against either one.
 */
export class WriteFileConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WriteFileConflictError"
  }
}
