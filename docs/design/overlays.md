# Overlays — every modal, dropdown, menu and bar

One document so nobody invents a sixth overlay pattern. Repo reference: `components/ui/dialog.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `sheet.tsx`.

## The five patterns

| Pattern | Geometry | Scrim | Used for |
| --- | --- | --- | --- |
| **Flow modal** | 640px, radius 18, `max-height: calc(100vh - 48px)`, flex column with fixed header/footer | `rgba(35,24,15,.26)` | add workspace, import |
| **Form modal** | 440–520px, radius 18, padding 22–36 | same | type/status editor, rename, delete confirmations, auth card (no scrim) |
| **Display modal** | 720–860px, radius 18, Lora 34/500 title | same | keyboard shortcuts |
| **Full overlay** | viewport-filling, own 48px chrome row | same | artifact preview, search |
| **Dropdown / popover** | min 200px, radius 10, `shadow-float-md`, 6px padding, items 34px | none | filters, type/status pickers, row menus |

Shared behavior: `odModalIn` 260ms on enter · `Esc` closes · focus trapped and returned to the trigger · click on the scrim closes (except when a field is dirty — then confirm) · body scroll locked.

## Inventory

### Desk

| Overlay | Trigger | Notes |
| --- | --- | --- |
| Artifact preview | `eye` on a row | full overlay; ← → navigate; right column 276px with type, status, path, metrics, sharing |
| Search | `search` in rail or `⌘K` | full overlay; 66px search row, grouped results, empty state "No results" |
| Filter menus (type, status, workspace) | filter bar buttons | dropdown; checkbox items + footer "N selected" / "Clear all" |
| Group-by menu | filter bar | dropdown; single-select with a check |
| Row menu (`⋯`) | row hover or focus | dropdown; Open · Preview · Rename · Set type · Set status · Move · Archive · divider · Delete (terracotta) |
| Selection bar | ≥1 row selected | dark bar, 56px, radius 14, bottom 26px — not a modal, but it owns the bottom of the sheet |
| Delete confirmation | Delete in row menu or bar | form modal; names the artifact; the button says "Delete artifact", never "OK" |

### Studio

| Overlay | Trigger | Notes |
| --- | --- | --- |
| Rename artifact | `pencil` or double-click on the title | form modal 440px; overline "Artifact name", 44px input, `⏎` saves, `Esc` cancels |
| Keyboard shortcuts | `keyboard` in the status bar or `⌘/` | display modal; three-column grid of `kbd` rows; note that the desktop app exposes native menu shortcuts |
| Type / status pickers | properties panel fields | dropdown; icon + name rows, current item checked |
| Format / insert menus | toolbar | dropdown; 34px items with a 24px glyph column |
| Suggestion bubble | text selection with a pending correction | not a modal: ink bubble anchored to the span, 11px label, Apply · Ignore · Learn |
| AI bar | always present | inline, not an overlay — documented in `docs/design/views/studio.md` |
| Tab context menu | right-click a tab | dropdown; Close · Close others · Close all |

### Workspace

| Overlay | Trigger | Notes |
| --- | --- | --- |
| Add workspace | "Add workspace" | flow modal, 5 steps — see `docs/design/views/add-workspace.md` |
| Manage included files | folder card menu | the same include step, opened standalone as a flow modal |
| Folder card menu | `⋯` | dropdown; Open · Reveal in Finder · Rename · Re-scan · Manage included files · divider · Disconnect |
| Disconnect confirmation | menu | form modal; copy must state local files are untouched |

### Settings

| Overlay | Trigger | Notes |
| --- | --- | --- |
| Type / status editor | "Edit" or a new-item row | form modal 520px; name, description + Improve with AI, icon grid, color row; footer Delete / lock note · Cancel · Save |
| Archive row menu | `⋯` | dropdown; Restore · Download · divider · Delete forever |
| Archive selection bar | ≥1 row selected | same component as the Desk's |
| Delete account | danger zone | form modal; typed confirmation; states that local files stay |

### Auth

The auth card is a form modal without a scrim, centered on the shell background. Password reveal and validation hints are inline, never overlays.

## Rules

- Radius 18 on modals, 10 on dropdowns. No other values.
- Dropdown items: 34px tall, radius 7, hover `#F2F1EF`, 24px glyph column so labels align whether or not an item has an icon.
- Destructive items are terracotta text on hover, never a red fill.
- Only one overlay at a time. A dropdown inside a modal is allowed; a modal from a modal is not — turn it into a step.
- Every overlay is reachable and dismissible by keyboard.
