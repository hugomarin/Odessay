# Odessay Keyboard Shortcuts

Este documento audita los shortcuts activos del editor y los separa por runtime para evitar colisiones con browser, sistema operativo y menú nativo desktop.

## Principios

- El mapa canónico del editor vive en `lib/editor/shortcuts.ts`.
- Desktop refleja esos shortcuts en el menú nativo cuando aplica.
- Web evita combinaciones que el browser o el sistema suelen interceptar primero.
- `⌘H` no se usa para Replace porque colisiona con Hide en macOS.

## Auditoría resumida

| Acción | Web | Desktop | Notas |
|---|---|---|---|
| Find | `⌘F` / `Ctrl+F` | `⌘F` / `Ctrl+F` | Sin conflicto relevante dentro del editor. |
| Replace | `⌘⌥F` / `Ctrl+Alt+F` | `⌘⌥F` / `Ctrl+Alt+F` | Se evita `⌘H` por colisión de sistema en macOS y por inconsistencia en browser. |
| New writing | UI visible | `⌘N` / `Ctrl+N` | Desktop usa shortcut nativo; web no lo captura para no pelear con el browser. |
| Shortcut help | `⌘/` / `Ctrl+/` | `⌘/` / `Ctrl+/` | Abre panel de ayuda del runtime actual. |
| Settings | `⌘,` / `Ctrl+,` | `⌘,` / `Ctrl+,` | Disponible en ambos runtimes. |

## Format

| Acción | Web | Desktop |
|---|---|---|
| Bold | `⌘B` / `Ctrl+B` | `⌘B` / `Ctrl+B` |
| Italic | `⌘I` / `Ctrl+I` | `⌘I` / `Ctrl+I` |
| Strike | `⌘⇧X` / `Ctrl+Shift+X` | `⌘⇧X` / `Ctrl+Shift+X` |
| Highlight | `⌘⇧H` / `Ctrl+Shift+H` | `⌘⇧H` / `Ctrl+Shift+H` |
| Inline code | `⌘⇧C` / `Ctrl+Shift+C` | `⌘⇧C` / `Ctrl+Shift+C` |
| Code block | `⌘⇧D` / `Ctrl+Shift+D` | `⌘⇧D` / `Ctrl+Shift+D` |
| Link | `⌘K` / `Ctrl+K` | `⌘K` / `Ctrl+K` |
| Image | `⌘⇧I` / `Ctrl+Shift+I` | `⌘⇧I` / `Ctrl+Shift+I` |
| Table | `⌘⇧T` / `Ctrl+Shift+T` | `⌘⇧T` / `Ctrl+Shift+T` |

## Structure

| Acción | Web | Desktop |
|---|---|---|
| Paragraph | `⌘⇧0` / `Ctrl+Shift+0` | `⌘⇧0` / `Ctrl+Shift+0` |
| Heading 1 | `⌘⇧1` / `Ctrl+Shift+1` | `⌘⇧1` / `Ctrl+Shift+1` |
| Heading 2 | `⌘⇧2` / `Ctrl+Shift+2` | `⌘⇧2` / `Ctrl+Shift+2` |
| Heading 3 | `⌘⇧9` / `Ctrl+Shift+9` | `⌘⇧9` / `Ctrl+Shift+9` |
| Blockquote | `⌘⇧6` / `Ctrl+Shift+6` | `⌘⇧6` / `Ctrl+Shift+6` |
| Bullet list | `⌘⇧L` / `Ctrl+Shift+L` | `⌘⇧L` / `Ctrl+Shift+L` |
| Ordered list | `⌘⇧O` / `Ctrl+Shift+O` | `⌘⇧O` / `Ctrl+Shift+O` |
| Footnote | `⌘⇧A` / `Ctrl+Shift+A` | `⌘⇧A` / `Ctrl+Shift+A` |

## Editor

| Acción | Web | Desktop |
|---|---|---|
| Focus mode | `⌘⇧F` / `Ctrl+Shift+F` | `⌘⇧F` / `Ctrl+Shift+F` |
| Properties panel | UI button | UI button | Descubrimiento visible en topbar. |
| Publication / Corrections | UI button | UI button | Descubrimiento visible en topbar. |
| Keyboard shortcuts help | `⌘/` / `Ctrl+/` | `⌘/` / `Ctrl+/` | También visible como botón en topbar. |

## Desktop menu contract

En desktop, el menú nativo debe mostrar shortcuts junto al comando cuando exista equivalente:

- File: New File, Open File, Save to Disk, Save As
- Edit: Find, Replace
- Format: headings, listas, link, table, image y formato inline
- View: Focus Mode
- Help: Keyboard Shortcuts

Si se cambia un shortcut en `lib/editor/shortcuts.ts`, el menú nativo de `src-tauri/src/lib.rs` debe actualizarse en el mismo cambio.
