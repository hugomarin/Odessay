# Icon map — every icon by role

Library: **lucide-react** (already in the repo via ShadCN). Always `strokeWidth={1.5}`; the only exceptions are `bold` / `italic` / `strikethrough` in the editor toolbar (`2`) and the checkbox `check` (`3`, at 12px).

Sizes: rail 19 · toolbar and row actions 14–16 · panel headers 16–17 · metadata and badges 12 · status bar 15 · overlay chrome 17–21.

An agent implementing a view should pick icons **from this table only**. If a needed icon is missing, that is a question for the design owner, not a free choice.

## Navigation and shell

| Role | Icon |
| --- | --- |
| New Artifact | `plus` |
| Search | `search` |
| Studio (editor) | `lamp-desk` |
| Desk | `layout-grid` |
| Workspace | `folder-tree` |
| Settings | `settings` |
| Sign out | `log-out` |
| Toggle rail | `panel-left` |
| Focus mode | `scan` |
| Share | `shapes` |
| Properties / notes panel | `align-left` |
| Table of contents | `list-tree` |
| Keyboard shortcuts | `keyboard` |
| Save state | `cloud-upload` |
| Collapse / expand row | `chevron-down` (rotated `-90deg` when closed) |
| Forward / drill in | `chevron-right` |
| Back | `chevron-left` / `arrow-left` |
| Close | `x` |
| More actions | `ellipsis` |

## Desk and artifact rows

| Role | Icon |
| --- | --- |
| Preview | `eye` |
| Edit / rename | `pencil` |
| Open full artifact | `square-arrow-out-up-right` |
| Select (checked state) | `check` |
| Filter by type | `shapes` |
| Filter by status | `circle-dashed` |
| Group by | `rows-3` |
| View toggle: table | `list` |
| View toggle: cards | `layout-grid` |
| Move to workspace | `folder-tree` |
| Archive | `archive` |
| Delete | `trash-2` |
| Restore | `undo-2` |
| Download | `download` |
| Duplicate | `copy` |
| Reveal in Finder | `folder-open` |

## Editor

| Role | Icon |
| --- | --- |
| Bold / italic / strikethrough | `bold` `italic` `strikethrough` |
| Inline code | `code-xml` |
| Link | `link` |
| Bulleted / numbered list | `list` `list-ordered` |
| Quote | `quote` |
| Heading menu | `heading` |
| Insert image | `image` |
| Insert table | `table` |
| AI action | `sparkles` |
| Dictate | `mic` |
| Pause / resume | `pause` `play` |
| Stop | filled square, not an icon |
| Learn word | `book-plus` |
| New tab | `plus` |

## Workspace and files

| Role | Icon |
| --- | --- |
| Folder (closed / open) | `folder` / `folder-open` |
| New folder | `folder-plus` |
| Pick a folder | `folder-search` |
| Markdown file | `file-text` |
| Code-ish artifact (landing diagram) | `file-code` |
| Duplicate files (landing diagram) | `files` |
| Only this (isolate selection) | `crosshair` |
| Ignore | `ban` |
| Undo ignore / restore | `rotate-ccw` |
| Re-scan | `refresh-cw` |
| Local / offline | `hard-drive` |
| Disconnect | `unlink` |
| Info note | `info` |
| Empty file state | `file-plus` |

## Artifact types (defaults offered in Settings)

`file-text` General · `bot` Agent · `wrench` Skill · `message-square` Prompt · `layout-template` Template · `sticky-note` Note · `book-open` Reference · `compass` Strategy · `flask-conical` Experiment · `quote` Transcript source · `list-checks` Checklist · `mic` Transcript

## Statuses (defaults offered in Settings)

`circle-dot` New · `circle-dashed` Exploring · `circle` Draft · `eye` In review · `circle-check` Done · `archive` Archived · `circle-x` Dropped · `flame` Hot

## Landing only

| Role | Icon |
| --- | --- |
| Action arrow | `arrow-right` |
| Agent (diagram) | `bot` |
| Copy / paste hop | `copy` |
| External doc tool | `file-text` |
| Export and send | `send` |
| Return to agent | `rotate-ccw` |
| Person node | `user-round` |

## Never

Emoji anywhere. Filled icon variants. Two different icons for the same concept across views (`folder-tree` is Workspace everywhere; `shapes` is type everywhere). Icons as decoration in body copy.
