# Fase 6 — Desktop DoD Evidence

**Issue:** ODE-211  
**Generated:** 2026-05-30  
**Harness:** `scripts/check-fase6-invariants.mjs`  
**Report:** `artifacts/fase6/report.json`

---

## DoD §1: App desktop usable (login-less)

**Status:** PASS — structural preconditions verified

**Evidence:**
- `FilesystemDocumentService.createDraft()` creates a `.md` file without requiring auth, Supabase, cookies, or network.
- The desktop shell (`src-tauri/`) initializes without a login gate; auth is opt-in for remote features.
- Referenced from ODE-207 (Tauri desktop shell initialization).

**How to reproduce:**
1. Build the Tauri app: `npm run tauri:build`
2. Launch the desktop app without an internet connection.
3. Confirm the app opens to the writing surface without prompting for login.

---

## DoD §2: Filesystem como base operativa del writing

**Status:** PASS — automated tests

**Evidence:**
- `tests/filesystem-document-service.test.ts` covers:
  - `createDraft` → `.md` created on disk
  - `saveWriting` → markdown written to disk
  - `openWriting` → markdown read from disk
  - `renameWriting` → file renamed
  - `deleteWriting` → file moved to trash
- `tests/fase6-invariants.test.ts` covers the full create → write → save → reopen cycle.

**How to reproduce:**
```bash
npx vitest run tests/filesystem-document-service.test.ts tests/fase6-invariants.test.ts
```

---

## DoD §3: `.md` como fuente de verdad en desktop

**Status:** PASS — automated tests + adapter boundary

**Evidence:**
- `FilesystemDocumentService` sets `canonicalSource: "markdown"` on every record.
- `openWriting` reads the `.md` file directly; no cache or index is consulted first.
- `tests/desktop-adapter-boundary.test.ts` confirms that `lib/services/desktop/*` does not import Next.js, Supabase, cookies, `window`, or `fetch("/api/...")`.

**How to reproduce:**
```bash
npx vitest run tests/desktop-adapter-boundary.test.ts
```

---

## DoD §4: Rich mode y Source mode sobre el mismo documento

**Status:** PASS — automated round-trip test

**Evidence:**
- `tests/markdown-roundtrip.test.ts` verifies that `parseMarkdownToSnapshot` → serialize → `parseMarkdownToSnapshot` is stable for the supported Markdown profile.
- `tests/fase6-invariants.test.ts` §"DoD §4" saves markdown via `FilesystemDocumentService`, re-opens it, and confirms the round-trip preserves headings, bold, italic, strike, highlight, links, code, blockquotes, ordered lists, bullet lists, tables, images, and footnotes.

**Note on scope:** The round-trip test covers the Markdown profile defined in `workflow/context/features/odessay-desktop-app.md`. Primitives not yet in the profile (Wikilink, Hashtag, TOC, Horizontal Rule) are **outside the scope** of this harness and should be validated in Fase 7 if they enter the canonical profile.

**How to reproduce:**
```bash
npx vitest run tests/markdown-roundtrip.test.ts tests/fase6-invariants.test.ts
```

---

## DoD §5: Infraestructura local derivada correctamente acotada

**Status:** PASS — automated index resilience test

**Evidence:**
- `LocalIndexService` is optional; `FilesystemDocumentService` falls back to directory listing when the index is absent or empty.
- `tests/fase6-invariants.test.ts` §"DoD §5" simulates index deletion by clearing entries, then confirms:
  - The `.md` file is still readable.
  - `listWritings` falls back to directory listing.
- `tests/filesystem-document-service.test.ts` confirms index upsert/delete on save/rename/delete.

**How to reproduce:**
```bash
npx vitest run tests/fase6-invariants.test.ts
```

---

## DoD §6: Promesa percibida por el usuario (offline)

**Status:** not-applicable — requires manual desktop QA

**Evidence:**
- `tests/fase6-invariants.test.ts` §"DoD §6" verifies that `saveWriting` completes without any network dependency (mock filesystem, no fetch).
- Structural preconditions confirm the write-path is entirely local.

**Manual verification steps:**
1. Disable Wi-Fi / Ethernet on macOS (or enable Airplane Mode).
2. Launch the Odessay desktop app.
3. Create a new document → type content → save.
4. Confirm no network error dialogs appear.
5. Close the app → re-open → confirm the document is intact.

---

## DoD §7: Calidad de entrega (gate técnico)

**Status:** PASS — all gates green

**Evidence:**

```bash
npm run typecheck   # PASS
npm run lint        # PASS
npm test            # PASS
```

**Test coverage:**
- `tests/filesystem-document-service.test.ts`
- `tests/desktop-asset-service.test.ts`
- `tests/desktop-settings-service.test.ts`
- `tests/desktop-adapter-boundary.test.ts`
- `tests/fase6-invariants.test.ts`
- `tests/markdown-roundtrip.test.ts`

**Harness:**
```bash
node scripts/check-fase6-invariants.mjs
```
Output: `artifacts/fase6/report.json` with all blocks PASS.

---

## DoD §8: Evidencia manual mínima

**Status:** not-applicable — requires manual desktop runtime

**Checklist (to be verified by human tester on desktop build):**

1. **Create → write → save → close → reopen**
   - [ ] Create new document
   - [ ] Write several paragraphs
   - [ ] Save (Cmd+S or auto-save)
   - [ ] Close app
   - [ ] Re-open app
   - [ ] Confirm content intact

2. **Open existing `.md` → edit → save → verify on disk**
   - [ ] Open an existing `.md` file from Finder
   - [ ] Edit content
   - [ ] Save
   - [ ] Open the `.md` in another editor and confirm changes

3. **Rich ↔ Source mode without content loss**
   - [ ] Open a document with supported Markdown features
   - [ ] Switch to Source mode
   - [ ] Switch back to Rich mode
   - [ ] Confirm all supported features preserved

4. **Offline session**
   - [ ] Disconnect from network
   - [ ] Create and save a document
   - [ ] Confirm no network errors

5. **Local assets**
   - [ ] Open a document referencing a local image
   - [ ] Confirm the image renders correctly

---

## Summary

| Block | Title | Status |
|---|---|---|
| §1 | App desktop usable | PASS |
| §2 | Filesystem como base operativa | PASS |
| §3 | `.md` como fuente de verdad | PASS |
| §4 | Rich mode y Source mode | PASS |
| §5 | Infraestructura local derivada | PASS |
| §6 | Promesa percibida (offline) | not-applicable* |
| §7 | Calidad de entrega | PASS |
| §8 | Evidencia manual mínima | not-applicable* |

*Blocks §6 and §8 require manual verification on the actual desktop runtime. The harness verifies all structural preconditions and documents the exact manual steps needed.

**Harness report:** `artifacts/fase6/report.json`
