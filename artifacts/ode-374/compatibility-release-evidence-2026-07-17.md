# ODE-374 compatibility release evidence

Date: 2026-07-17
Candidate commit: `41e8acc`
Candidate version: `0.3.6`
Bundle id: `com.z9ne.odessay`

This report intentionally contains no document titles, UUIDs, file names, or user paths.

## Release artifacts

| Artifact | Result |
| --- | --- |
| `ArtifactStudio-0.3.6-aarch64.dmg` | Built successfully; SHA-256 `c10d788056954a0ec6e0294f918a7196491c010c9da4a04a213fae6e22290ca1` |
| `ArtifactStudio_0.3.6_aarch64.app.tar.gz` | Built successfully; SHA-256 `d020f99fbefc9010a88714a464acee2452ac4b47dec21b0b3a9305903cfbad07` |
| Updater signature | Present and accepted by the release script |
| `latest.json` | Generated; version `0.3.6`; top-level signature present |
| Static desktop validation | 0 failures, 1 environment warning (`NEXT_PUBLIC_APP_URL` was not supplied to the validator process; the production URL was supplied to the build) |
| macOS application signature | Ad-hoc, matching the existing local distribution mode |

The built frontend contains `NEXT_PUBLIC_DESKTOP_INDEXEDDB_MIGRATION=true` and the global M5 startup trigger.

## Same-channel runtime validation

The candidate was installed over the existing `/Applications` channel after a recoverable backup of the application and the `com.z9ne.odessay` Application Support/WebKit containers.

| Check | Before | After M5 | Second start |
| --- | ---: | ---: | ---: |
| SQLite integrity | `ok` | `ok` | `ok` |
| Catalog documents | 324 | 324 | 324 |
| Catalog bindings | 209 | 210 | 209 |
| Sync mutations | 4,391 | 4,391 | 4,391 |
| Pending sync mutations | 3,956 | 3,956 | 3,956 |
| Failed sync mutations | 6 | 6 | 6 |

The transient binding was removed by filesystem reconciliation on restart; the post-restart catalog is set-equal to the pre-migration catalog. The checkpoint timestamp did not change on the second start.

A catalog-backed writing opened successfully after migration, hydrated its Markdown content, rendered its table of contents, and reported `Saved`.

## IndexedDB parity

| Metric | Value |
| --- | ---: |
| Source rows across two scopes | 428 |
| Unique source identities | 320 |
| Cross-scope duplicate identities | 108 |
| Source identities present in SQLite | 320 |
| Source identities missing from SQLite | 0 |
| Completed checkpoint identities | 320 |
| Checkpoint/source set SHA-256 | `a41a412bcf5a5c04d19c738d0b8a4acc1b5bc1c83b9bcf95d85a9f4db3f17646` |
| Migration commit errors | 0 |

The completed checkpoint records 122 explicit, recoverable conflicts: 108 UUID divergences between scopes, 5 path collisions, and 9 unbound hash collisions.

## Retirement blockers discovered

1. The candidate still uses version `0.3.6`, the same version as the pre-M5 official app. It is not yet a distinct compatibility release that can establish a post-M5 release boundary.
2. Three active, locally present, bound catalog identities are not UUIDs. Their files exist, but their binding root has no `.odessay/index.json` ledger.
3. The read-only ODE-374 filesystem harvest over that managed root found 769 Markdown files with no v2 manifest authority:
   - 370 would preserve an identity sourced from legacy frontmatter;
   - 399 require a proposed client UUID;
   - 0 are currently backed by a v2 manifest entry.
4. Removing frontmatter/path compatibility now would strand historical identity evidence and violate the UUID + durable manifest invariants.
5. The existing pending/failed sync queue must not be described as zero. The migration itself added no queue rows and did not worsen the queue.

## Gate decision

**NOT ACCEPTED — cleanup PR remains blocked.**

Before runtime compatibility can be deleted, ODE-374 needs an approved write-phase harvest that materializes UUID bindings into `.odessay/index.json`, reconciles the three active non-UUID catalog identities, verifies the resulting manifest/catalog parity, and produces a distinctly versioned same-channel compatibility release. Explicit owner acceptance is still required after that evidence.

## Authorized write phase

The owner authorized the write phase on 2026-07-17. It completed with a
recoverable backup and checkpoint before runtime cleanup:

| Check | Result |
| --- | ---: |
| Markdown files covered | 769 |
| Manifest v2 bindings | 769 |
| Unique UUIDs | 769 |
| SQLite bindings for the migrated root | 769 |
| Non-UUID active bindings after migration | 0 |
| Historical path identities rekeyed | 3 |
| Markdown fingerprint before/after | Identical |
| SQLite integrity / foreign keys | `ok` / 0 violations |
| Restart manifest/catalog stability | Stable |
| Queue rows preserved | 4,391 |

The local backup contains the pre-write SQLite database, source report, write
plan, prior manifest state and stage checkpoint. The report and backup remain
local because they contain user paths; this tracked evidence is intentionally
sanitized.

## Collection compatibility boundary

The 0.3.7 intermediate candidate exposed one remaining compatibility gap before
final cleanup: the active desktop IndexedDB scope contained 12 collections and
56 writing/collection relations (the anonymous scope contained 11/3). The
intermediate candidate copied the deduplicated active state into normalized
SQLite v5 tables without deleting either source scope. Runtime validation then
rendered all 12 collections and their document counts from SQLite.

The existing writing queue contained 3,962 pending/failed snapshot upserts for
only four document identities. SQLite v5 preserved all 4,391 rows and marked
older snapshots superseded, leaving only the latest snapshot per document
eligible for delivery. No queue row was deleted.

## Final cleanup candidate

The final cleanup candidate is versioned `0.3.8`; the bounded collection
migrator used by 0.3.7 is absent from this release.

| Check | Result |
| --- | --- |
| Signed DMG | `ArtifactStudio-0.3.8-aarch64.dmg` |
| DMG SHA-256 | `b52c6ae0fb7e47d0f1cab36967178b7d031b08a72c56d2279fe0ae4dc223fdb0` |
| Updater archive SHA-256 | `95c51fb9bf89c6bf5df35512cfbe61dd0942294a746a986b067d88cd9cdce251` |
| Update manifest | version `0.3.8`, signature present |
| Same-channel installation | `/Applications/Artifact Studio.app`, version `0.3.8` |
| SQLite schema / integrity | v5 / `ok`, zero foreign-key violations |
| Legacy `writings_index` | absent |
| Documents / bindings | 923 / 829 |
| Active non-UUID bindings | 0 |
| Collections / relations | 12 / 56 |
| Sync queue | 4,391 rows preserved; all superseded/current snapshots accounted for |
| Second restart | counts and integrity stable |
| UI evidence | Desk rendered the catalog; Collections rendered all 12 migrated collections |

The 0.3.8 runtime contains no desktop IndexedDB migration trigger, no desktop
IndexedDB fallback, no frontmatter identity reader, no Rust UUID mint fallback,
no path-only index service and no normal-runtime `.odyssey` reader. Web
IndexedDB remains enabled and covered by the full test suite.

## Final gate decision

**READY FOR OWNER REVIEW.** The destructive compatibility cleanup is backed by
recoverable local backups, a stable v2 manifest, SQLite parity, two same-channel
release installs and restart evidence. The source IndexedDB databases and local
backup/checkpoint directories remain intact for rollback.
