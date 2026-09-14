# ODE-526 — Remediation summary

Pre-change audit: `npm audit --omit=dev --json` → `pre-change-audit.json` (13 advisories: 1 critical, 7 high, 5 moderate).
Post-change audit: `post-change-audit.json` (2 advisories, both stemming from one source — see the exception in `dependency-exceptions.md`).

| Package | Direct/transitive | Installed path (before) | Fixed version | Disposition |
|---|---|---|---|---|
| `next` | direct | `node_modules/next@15.5.13` | `>=15.5.18` (per-advisory floors; latest 15.x at time of fix: `15.5.25`) | **Remediated** — compatible upgrade within the existing `^15.0.0` range. All of Next's own direct advisories (DoS, middleware/proxy bypass, CSP-nonce XSS, cache poisoning, SSRF via WebSocket upgrade, RCE via AVIF image optimization, etc. — see `pre-change-audit.json` for the full advisory list) resolved. |
| `@tiptap/core` | direct | `node_modules/@tiptap/core@3.22.5` | `>=3.30.5` | **Remediated** — whole TipTap family realigned to `^3.31.3` in `package.json` (was a mix of `^3.20.4`/`^3.22.5`/`^3.21.0`, plus one exact-pinned outlier). Single deduped `@tiptap/core` instance in the tree afterward — no split schema risk. |
| `@tiptap/extension-horizontal-rule` | direct | `node_modules/@tiptap/extension-horizontal-rule@3.22.5` | `>=3.30.4` (tracks `@tiptap/core`) | **Remediated** — same family realignment. |
| `@tiptap/extension-image` | direct | `node_modules/@tiptap/extension-image@3.22.5` | `>=3.30.4` (tracks `@tiptap/core`) | **Remediated** — same family realignment. |
| `@tiptap/extension-table-of-contents` | direct | `node_modules/@tiptap/extension-table-of-contents@3.20.4` (exact-pinned, no caret — this was what blocked `npm audit fix` from resolving `uuid` below without `--force`) | `>=3.31.3` | **Remediated** — un-pinned to `^3.31.3`, matching the rest of the family. |
| `uuid` | transitive (via `@tiptap/extension-table-of-contents`) | `node_modules/uuid@10.0.0` | `>=11.1.1` | **Remediated** — resolved automatically once `@tiptap/extension-table-of-contents` moved off its exact pin; now `uuid@14.0.2`. |
| `js-yaml` | direct | `node_modules/js-yaml@4.1.1` | `>=4.3.2` | **Remediated** — compatible bump within the existing `^4.1.1` range, now `4.3.2`. |
| `linkify-it` | transitive (via `markdown-it`) | `node_modules/linkify-it@5.0.0` | `>5.0.1` | **Remediated** — now `5.0.2`. |
| `markdown-it` | transitive (via `tiptap-markdown`) | `node_modules/markdown-it@14.1.1` | `>14.1.1` | **Remediated** — now `14.3.2`, single deduped instance. |
| `nanoid` | transitive (via `docx` and others) | `node_modules/nanoid@3.3.11` / `node_modules/docx/node_modules/nanoid@5.1.7` | `>3.3.17` and `>5.1.15` respectively | **Remediated** — both lines now above their floors (`3.3.19`, `5.1.16`). |
| `sharp` | transitive (via `next`) | `node_modules/sharp@0.34.5` | `>=0.35.4` | **Remediated** — now `0.35.4`; `tests/export.test.ts` / `tests/api/writings-export-route.test.ts` (image-processing paths) re-verified passing. |
| `ws` | transitive | `node_modules/ws@8.19.0` | `>8.20.1` | **Remediated** — now `8.21.3`. |
| `postcss` | transitive (bundled inside `next`) | `node_modules/next/node_modules/postcss@8.4.31` | `>=8.5.23`, only reachable via `next@16.3.5` (semver-major) | **Exception recorded** — see `dependency-exceptions.md`. Confirmed build-time-only usage (`next/dist/build/webpack/**`), never invoked under `next/dist/server/**`; no application feature processes untrusted CSS. Reviewed 2026-09-13, next review 2026-12-13. |

`next` reappears in the post-change audit purely as npm's "depends on vulnerable `postcss`" flag, not because Next itself carries an unresolved advisory of its own — every advisory that was actually attributed directly to `next` in the pre-change audit is gone.

## Validation performed

- `npm run typecheck` — clean.
- `npm run lint` — no new warnings versus the pre-existing baseline.
- `npx vitest run` — 249 files / 1997 tests passing (one pre-existing, unrelated, load-sensitive git-fixture test in `tests/traceability-base-resolution.test.ts` timed out once under full-suite parallel load and passed cleanly in isolation and on a clean re-run — not touched by this change, same class of flake previously noted on ODE-523).
- `tests/export.test.ts`, `tests/api/writings-export-route.test.ts`, `tests/lib/services/desktop/export-delivery.test.ts` — export/image pipeline (exercises the `sharp` upgrade) re-verified in isolation.
- Production web build (`npm run build`, SSR/API routes/middleware): all routes compiled and collected successfully.
- Production desktop static-export build (`node scripts/prepare-tauri-build.mjs`, the exact `beforeBuildCommand` Tauri itself invokes): all 31 pages generated and exported successfully, including every TipTap editor route (`/write`, `/write/[id]`, `/write/new`).
- Bundle composition inspected qualitatively post-upgrade: route list and First Load JS sizes for editor-bearing routes (`/write*`, `/workspace*`, `/desk`, `/collections*`) are in the same ~1.15–1.2 MB range as before, consistent with no material regression from either the Next patch bump or the TipTap 3.22→3.31 realignment.
