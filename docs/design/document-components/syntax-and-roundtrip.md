# Controlled document components — syntax and round-trip

This document is the normative grammar for the Fase 12 controlled component profile. It extends the existing Odessay Markdown profile; it is not MDX and never executes JSX, ESM, JavaScript, or arbitrary HTML.

## Families

1. **Pure Markdown** — paragraphs, headings, emphasis, links, lists, quotes, thematic breaks, images, inline code, and fenced code. Fenced code is opaque to the component parser. A `mermaid` info string is still a fenced `CodeBlock`, not an executable component.
2. **Odessay semantic inline** — `Annotation`, `Highlight`, `Entity`, and `ProtectedText`. These are balanced inline tags whose children are Markdown inline content.
3. **Registered blocks** — `Tip`, `Info`, `Card`, `AccordionGroup`, `Accordion`, `Tabs`, `Tab`, `Steps`, `Step`, `CardGroup`, and `CodeGroup`. They are balanced block tags registered in the profile.

`CodeBlock` is the canonical registry kind for a Markdown fence. It is not serialized as `<CodeBlock>`.

## Lexical grammar

- Registered names are case-sensitive PascalCase ASCII identifiers. Lowercase or namespaced spellings are unknown source.
- Opening tags use `<Kind attr="value">`; closing tags use `</Kind>`.
- Controlled components are never self-closing. Empty content is valid only where the registry content model explicitly permits it while authoring.
- Attribute names are case-sensitive ASCII identifiers. Duplicate, unknown, unquoted, spread, expression, event-handler, or `style` attributes invalidate the whole component span.
- Attribute values are double-quoted strings. Canonical escaping is `&amp;`, `&quot;`, `&lt;`, and `&gt;`, in that decoding/encoding order. Numeric and named entities outside this set remain literal recoverable source.
- Canonical attribute order is the order declared by the registry, not source order. Optional absent attributes are omitted. Boolean capabilities use `"true"` or `"false"`; there is no shorthand.
- An inline component may occur within one Markdown text block. It cannot cross a block boundary.
- A block opening or closing tag occupies its own line. One blank line separates a registered block from adjacent sibling Markdown or component blocks. Container children may be adjacent with no extra prose between their tags.
- Indentation is not semantic for component tags. Markdown inside a block follows the existing Markdown profile.

## Registered content models

| Kind | Form | Attributes in canonical order | Content | Allowed parent |
| --- | --- | --- | --- | --- |
| `Annotation` | inline | `id`, `type`, `comment` | non-empty inline Markdown | text block |
| `Highlight` | inline | `id`, `color` | non-empty inline Markdown | text block |
| `Entity` | inline | `id`, `type`, `ref` | non-empty inline Markdown | text block |
| `ProtectedText` | inline | `id`, `reason` | non-empty inline Markdown | text block |
| `Tip` | block | `title` | block Markdown | document, `Tab`, `Step` |
| `Info` | block | `title` | block Markdown | document, `Tab`, `Step` |
| `Card` | block | `title`, `icon`, `href` | block Markdown | document, `CardGroup`, `Tab`, `Step` |
| `AccordionGroup` | block container | none | one or more `Accordion` | document, `Tab`, `Step` |
| `Accordion` | block item | `title` | block Markdown | `AccordionGroup` only |
| `Tabs` | block container | none | two or more `Tab` | document, `Tab`, `Step` |
| `Tab` | block item | `title` | block Markdown | `Tabs` only |
| `Steps` | block container | none | one or more `Step` | document, `Tab` |
| `Step` | block item | `title` | block Markdown | `Steps` only |
| `CardGroup` | block container | `columns` | one or more `Card` | document, `Tab`, `Step` |
| `CodeGroup` | block container | none | two or more fenced `CodeBlock` nodes | document, `Tab`, `Step` |
| `CodeBlock` | Markdown fence | `language` (info string) | literal source | document or permitted block container |

`id` is required and stable for semantic inline kinds. `type` is required for `Annotation` and `Entity`; `comment` is required for `Annotation`; `reason`, `color`, and `ref` are optional. `title` is required for `Card`, `Accordion`, `Tab`, and `Step`, and optional for `Tip`/`Info`. `columns` is an integer string from `1` through `4`. `href` accepts only the URL policy defined by the surface projection contract.

The specialized documentation catalog (`ParamField`, `ResponseField`, `RequestExample`, `Tree`, `Frame`, `Prompt`, `Color`, `Columns`, `Update`, and `Expandable`) is not registered in this profile.

## Parse and recovery

The parser scans once, skipping fenced code before recognizing tags. A known component is admitted only after its complete span has balanced tags, valid attributes, a valid content model, and legal nesting. Diagnostics identify the smallest recoverable span and source offsets.

Unknown names or versions, malformed tags, invalid attributes, and invalid nesting become one opaque-source node containing the exact input bytes. A diagnostic never authorizes a partial rewrite, annotation cleanup, fallback draft, or persistence side effect. If a complete safe span cannot be determined, the remaining source from the opening token is opaque.

Legacy `==text==[@n: comment]` is read-only compatibility. It parses as `Annotation` with a deterministic compatibility ID, but canonical serialization always emits `<Annotation>`.

## Canonicalization and round-trip

Two properties are distinct:

- **Semantic round-trip:** parsing and serializing a valid document preserves ordered content, component kind, stable identity, attributes, nesting, Markdown meaning, and literal fenced-code contents.
- **Canonical idempotence:** after the first successful canonical serialization, serializing the result again produces identical UTF-8 bytes.

Known valid components canonicalize tag spacing, attribute order/escaping, line endings (`LF`), and block separation. Opaque nodes bypass canonicalization and serialize their raw bytes exactly. Consequently a document containing opaque source can still preserve bytes even though surrounding known nodes canonicalize.

Full-document parse/serialize is allowed at open/import, coalesced save snapshots, explicit Rich/Source transitions, reading snapshots, and export. It is forbidden in the synchronous per-keystroke transaction path. The engine target is O(N) in source length and O(1) registry lookup by canonical kind.

