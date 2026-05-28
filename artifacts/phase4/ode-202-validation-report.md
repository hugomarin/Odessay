# ODE-202 — Harden Export Route for Unicode-Safe Filenames

**Generated:** 2026-05-28  
**Issue:** ODE-202 — Harden export route for unicode-safe filenames and rerun Fase 4 service closure validation  
**Branch:** `codex/ode-202-harden-export-unicode-filenames`

---

## Summary

Fixed the `Content-Disposition` header encoding in `GET /api/writings/[id]/export` so that Unicode characters in writing titles (e.g., em-dashes `—`) no longer cause a `ByteString` failure when building the download response.

The fix is adapter-layer only: the export document generation pipeline (`lib/export/writing-export.ts`) is unchanged.

---

## Changes Made

| File | Change |
|---|---|
| `app/api/writings/[id]/export/route.ts` | Added `buildContentDisposition()` helper that emits both a legacy ASCII `filename` parameter and an RFC 5987 `filename*=UTF-8''` parameter for modern browsers. |
| `tests/api/writings-export-route.test.ts` | New API route tests verifying correct `Content-Disposition` encoding for Unicode titles in both PDF and DOCX exports, plus edge cases (all-non-ASCII titles). |
| `tests/export.test.ts` | Added unit test confirming `sanitizeFileName` preserves Unicode punctuation so the adapter layer can encode it. |

---

## Automated Validation — ✅ PASS

### Unit & Integration Tests
| Suite | Result | Tests |
|---|---|---|
| `npm run typecheck` | ✅ PASS | 0 errors |
| `npm run lint` | ✅ PASS | 0 errors (6 pre-existing warnings) |
| `npm test` (full vitest) | ✅ PASS | 87 files, 509 tests |
| Fase 4 vitest suites | ✅ PASS | 15 files, 91 tests |

### Export-Specific Validation
| Suite | Result |
|---|---|
| `tests/export.test.ts` | ✅ PASS (10 tests) |
| `tests/api/writings-export-route.test.ts` | ✅ PASS (4 tests) |

### Delivery Gate
| Gate | Result |
|---|---|
| `npm run ops:delivery:gate` | ✅ PASS |

---

## Fase 4 Closure Matrix — Export Revalidated

| Service | Contract | Before Fix | After Fix |
|---|---|---|---|
| `DocumentService.exportWriting` | Document generation | ✅ No change | ✅ No change |
| `/api/writings/[id]/export` | Adapter delivery | ❌ ByteString crash on Unicode titles | ✅ RFC 5987 encoded headers |
| PDF export | End-to-end | ❌ Fails for Unicode titles | ✅ Pass |
| DOCX export | End-to-end | ❌ Fails for Unicode titles | ✅ Pass |

---

## Pre-existing Playwright Note

The Fase 4 Playwright closure flow (`tests/playwright/fase4-closure.e2e.ts`) has a **pre-existing failure on `main`** in the `assertPreviewFixture` step caused by unauthorized console errors on the preview page. This failure is **unrelated to export** and was confirmed by running the same test against `main` without ODE-202 changes.

Export-specific Playwright coverage is not part of the existing Fase 4 closure harness; export is validated at the unit and API route level as shown above.

---

## Evidence Files

- `artifacts/phase4/ode-202-validation-report.md` (this file)
- `tests/api/writings-export-route.test.ts` (automated regression)

---

## Veredicto

**Export adapter hardened for Unicode-safe filenames.** ✅  
**Fase 4 service matrix revalidated with export as passing.** ✅
