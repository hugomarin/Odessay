# Controlled document components — surface projections

Every enabled registry kind must declare all projections below before its writer capability can be enabled. Missing coverage is a build/rollout failure, never an invitation for a surface-specific parser.

## Surface policy

| Surface | Projection contract |
| --- | --- |
| Rich editor | TipTap adapter preserves kind, identity, attributes, content, nesting, undo/redo, and localized diagnostics. Authoring affordances are allowed. |
| Source editor | Exact controlled Markdown. Opaque/invalid source is byte-preserved and diagnostics do not rewrite it. |
| Write preview | Shared reading renderer, with no mutation controls or private semantic metadata. |
| Preview link | Same shared renderer and fallback semantics as write preview. |
| Shared/public reading | Same semantic content and accessible interaction; no authoring controls, comments, reasons, IDs, or collaboration state. |
| `body_text` | Ordered visible text only. Strip comments, reasons, IDs, refs, controls, and code-fence delimiters; preserve literal code and all nested labels/body text. |
| AI context | Plain `body_text` by default. An explicit authorized structured mode may include kind/type and public link semantics, never private annotation/protection metadata by default. |
| Clean Markdown | Portable headings, paragraphs, links, lists, quotes, images, and fences; flatten containers in reading order and remove component controls/private metadata. |
| PDF | Accessible linear hierarchy preserving headings, titles, links, code, nested content, image alt text, and Mermaid source/caption fallback. |
| DOCX | Same logical hierarchy and privacy policy as PDF using native paragraphs, headings, links, lists, and code styles. |

## Kind projection matrix

`shared` means all four reading surfaces use the shared renderer. `text` means visible child text contributes in order.

| Kind | Rich | Source | Reading | `body_text` / AI default | Clean Markdown | PDF / DOCX |
| --- | --- | --- | --- | --- | --- | --- |
| `Annotation` | semantic mark + configuration | canonical tag | child text; annotation metadata hidden | child text | child inline Markdown | child inline content |
| `Highlight` | semantic mark | canonical tag | visual emphasis with non-color cue | child text | child inline Markdown/emphasis | emphasized child content |
| `Entity` | semantic mark + type | canonical tag | accessible entity styling; safe link only when allowed | label text | label, plus safe link when public | label, plus safe link when public |
| `ProtectedText` | guarded semantic mark + explicit unlock | canonical tag | child text, no lock claim | child text | child inline Markdown | child inline content |
| `Tip` / `Info` | editable callout | canonical block | shared accessible callout | optional title then body | blockquote with bold label/title | titled callout structure |
| `Card` | editable title/body + attribute popover | canonical block | shared card; safe link/icon fallback | title then body | heading, optional safe link, then body | titled section with safe link/body |
| `AccordionGroup` / `Accordion` | editable grouped structure | canonical nested blocks | one accessible disclosure owner; all content present without JS | group/item titles then bodies | headings then bodies | expanded linear sections |
| `Tabs` / `Tab` | editable grouped structure | canonical nested blocks | one accessible tab owner; SSR contains all panels | tab titles then bodies | headings then bodies | linear titled sections |
| `Steps` / `Step` | editable ordered structure | canonical nested blocks | accessible ordered steps | numbered title/body order | ordered headings/body | numbered sections |
| `CardGroup` | editable group | canonical nested blocks | shared responsive group | every card in order | cards flattened in order | cards flattened in order |
| `CodeGroup` | editable group of fences | canonical group + fences | accessible labels and code panels; all source present | language label then literal code | consecutive fenced blocks | labeled literal code blocks |
| `CodeBlock` | native fenced-code node + language selector | Markdown fence | escaped literal code; unsupported language is plain code | literal code | identical safe fence | literal monospaced code |
| Mermaid (`CodeBlock`) | source-first, lazy preview | `mermaid` fence | sanitized lazy diagram plus source/caption fallback | source text/caption | unchanged fence | sanitized render when available, otherwise source/caption |
| Opaque source | diagnostic, non-destructive source affordance | exact bytes | escaped source fallback | conservative visible/source text | exact recoverable source | escaped/source fallback; never omitted silently |

## Links, assets, and privacy

- Links accept `https`, `http`, `mailto`, document-relative paths, and in-document fragments. `javascript`, `data`, `file`, and unknown schemes are not activated. Rejected URLs remain visible text/source.
- Images remain pure Markdown assets. Readers and exporters use the existing safe asset resolution boundary, size/redirect limits, alt text, and failure placeholders.
- Card icons are registered tokens or safe resolved assets; arbitrary markup is never rendered.
- Mermaid output is sanitized, cached by source hash, loaded lazily, and discarded when stale. Source is always retained.
- Default projections exclude annotation comments/types when private, protection reasons, stable IDs, collaboration state, and internal entity refs. Clean/export projections never imply that `ProtectedText` remains protected.

## Structural emptiness and coverage

A document is non-empty when its IR contains meaningful text, a literal code payload, a resolvable asset with alt text, or a registered structural component whose content model represents author intent. Plain-text emptiness alone does not erase a valid empty authoring structure.

The rollout gate enumerates the static registry and requires a handler for Rich adapter, Source serialization, shared reading, plain text, clean Markdown, PDF, and DOCX. Readers may use a documented safe fallback; writers remain disabled until full required coverage exists.

