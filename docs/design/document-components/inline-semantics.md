# Controlled document components — inline semantics

This contract defines identity and mutation behavior for `Annotation`, `Highlight`, `Entity`, and `ProtectedText`. The materialized Markdown remains content authority; collaborative annotation state is joined from `margins` by the same stable annotation ID.

## Shared range rules

- Semantic ranges must be non-empty, remain inside one text block, and have balanced boundaries.
- Native inline Markdown marks may overlap semantic ranges when the resulting tree is serializable.
- Semantic ranges may be nested only in this canonical order, outermost to innermost: `ProtectedText` → `Annotation` → `Entity` → `Highlight` → native Markdown marks. Partial/crossing overlaps are rejected atomically.
- Reapplying the same kind to the exact same range edits its attributes rather than creating a duplicate wrapper.
- Applying a kind across incompatible semantic boundaries is a no-op with a localized explanation. Commands never split identities silently.
- `Annotation`, `Entity`, and `ProtectedText` carry a required stable `id`. IDs are document-scoped, opaque strings and are never regenerated during normal round-trip. `Highlight` carries no `id` in v1; only its optional `color` attribute.

## Per-kind meaning

| Kind | Meaning | Identity behavior | Default text projection |
| --- | --- | --- | --- |
| `Annotation` | Anchored editorial comment | `id` joins durable `margins`; text, type, and comment are governed by Markdown | text only; comment/ID excluded |
| `Highlight` | Author-selected emphasis with optional color | no `id` in v1; reapplying on the same range edits its `color` | text only; color excluded |
| `Entity` | Typed semantic reference with optional external ref | `id` identifies the entity and may be shared by compatible mentions; `ref` identifies the target when present | visible label text only |
| `ProtectedText` | Rich-editor mutation guard with optional reason | `id` persists until explicit unlock/removal | text only; reason/ID excluded |

`ProtectedText` is an editor safeguard, not encryption, authorization, DRM, or protection in Source mode or exported files.

## Copy, paste, duplication, and movement

- Moving a range inside the same document preserves IDs.
- Copying within the same document preserves IDs only for a cut/move transaction. A true duplicate mints new IDs for every semantic occurrence in one atomic command. `Entity` is the exception: its `id` identifies the entity rather than the occurrence, so paste and duplicate preserve it. A pasted or duplicated mention whose `id` already exists with an incompatible `type` or `ref` is rejected atomically.
- Copying to another document always mints new IDs. `Annotation` copies visible text and comment metadata but does not copy remote collaboration state; the receiving document may create its own margin projection after a confirmed save.
- Plain-text paste strips all semantic metadata. Controlled rich paste parses the same profile, validates nesting, and remaps IDs before insertion.
- Paste, drop, undo, and redo either apply the entire valid structure or make no mutation. Unknown source remains opaque.

## Mutation and unlock

Ordinary typing, delete, replace, paste, drag/drop, find/replace, corrections, and AI actions must refuse any transaction that changes text inside or partially crosses a `ProtectedText` range. Selecting and copying protected text is allowed.

Unlock is an explicit editor command scoped to the selected `ProtectedText` identity. It removes only the protection wrapper, preserves its children and other semantic marks, participates in undo/redo, and records no persistence outside the normal document save. Source mode can edit raw source and therefore does not claim protection; returning to Rich reparses and reports invalid structure without destructive repair.

AI/context consumers receive plain visible text by default. An explicit authorized structured-context projection may include semantic kind and allowed attributes, but must exclude annotation comments, protection reasons, stable IDs, and external refs unless that operation declares a narrower need.

## Legacy annotations

Legacy `==text==[@n: comment]` is accepted only by the compatibility reader. Its deterministic compatibility ID must remain stable for the same source occurrence during migration. Any successful canonical write emits `<Annotation id="…" type="…" comment="…">text</Annotation>` and never recreates legacy syntax. Invalid mixed legacy/new source is recoverable and cannot be interpreted as deletion of durable margins.

