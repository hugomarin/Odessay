# ODE-526 — Dependency exceptions

One advisory could not be remediated without a Next.js major-version upgrade. Recorded per the issue's requirement 5 (severity alone is not an exception).

## PostCSS bundled inside Next.js's build pipeline

- **Installed path**: `node_modules/next/node_modules/postcss@8.4.31` (bundled internally by `next@15.5.25`, not a project-level dependency — the project's own `postcss` in `devDependencies` is a separate, unrelated installation used by Tailwind).
- **Advisories**:
  - [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) — XSS via unescaped `</style>` in CSS stringify output (moderate).
  - [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) / [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) / [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) — arbitrary file read via attacker-controlled `sourceMappingURL` in CSS comments (high).
- **Fix floor**: postcss ≥8.5.23, only satisfiable in this dependency tree by upgrading to `next@16.3.5` — a semver-major release. `npm audit` flags this explicitly as `isSemVerMajor: true`.
- **Why unreachable in this application**: every reference to this bundled `postcss` instance across `next@15.5.25`'s distribution lives under `next/dist/build/webpack/**` (`config/blocks/css/index.js`, `plugins/css-minimizer-plugin.js`, `loaders/next-font-loader/postcss-next-font.js`, `loaders/resolve-url-loader/index.js`) — confirmed by `grep -rl "require(\"postcss\")|from \"postcss\"" node_modules/next/dist/`, which returns zero matches under `next/dist/server/**`. This copy of postcss runs exclusively during `next build`'s webpack CSS pipeline, processing the project's own on-disk CSS/Tailwind sources and font configuration at build time. It is never invoked on a live server to process request-supplied or otherwise attacker-controlled CSS — Odessay has no feature that accepts user-supplied stylesheets or triggers a build from request-time input. Both advisory mechanisms (stringify-time HTML injection, source-map-comment-driven arbitrary file read) require postcss to process untrusted CSS input at the point of exploitation; that input never exists in this application's runtime.
- **Compensating control**: the CI/build environment only ever processes developer-authored CSS/Tailwind sources checked into the repository; no build step reads externally-supplied CSS. Application runtime code (everything under `next/dist/server/**`) has zero dependency on this postcss instance.
- **Owner**: Hugo Marin (project owner / assignee of ODE-518 and its sub-issues).
- **Review/expiry date**: 2026-12-13 (90 days from this remediation), or sooner if the team schedules a Next.js major-version evaluation for another reason — whichever comes first. Re-run `npm audit --omit=dev` at that time; if the floor has moved to a Next 15.x patch, remediate then instead of waiting for Next 16.

No other advisory from the original 13 required an exception — see `pre-change-audit.json` (13 findings) vs. `post-change-audit.json` (2 findings, both stemming from this single postcss instance) for the full before/after.
