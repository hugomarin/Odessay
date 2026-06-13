# Odessay Keyboard Shortcuts

Este documento lista los shortcuts del editor por runtime (web vs desktop) para evitar colisiones con browser, sistema operativo y menú nativo desktop.

## Principios

- El mapa canónico vive en [`lib/editor/shortcuts.ts`](../lib/editor/shortcuts.ts) (única fuente de verdad).
- El menú nativo de macOS ([`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs)) refleja esos shortcuts para desktop y **nunca debe divergir**.
- No se reutilizan básicos del sistema/edición de texto: `⌘C` (copiar), `⌘X` (cortar), `⌘V` (pegar), `⌘A` (seleccionar todo), `⌘Z` (deshacer), `⌘W` (cerrar ventana), `⌘Q` (salir), `⌘H` (ocultar app), `⌘M` (minimizar).
- El namespace `⌘⌥` (Cmd+Option) se usa para navegación y documento — libre de reservas del sistema/browser.

## Runtime

- **Both** — funciona en web y desktop.
- **Desktop** — funciona en la app desktop; en navegador esa combinación la intercepta el browser (cambio de pestaña, barra de direcciones, reabrir pestaña, reset zoom). Desktop es el target primario.

## Descubrimiento (Requirement #6)

- **Diálogo de ayuda** — `⌘/` (web + desktop) abre la lista completa según el runtime activo.
- **Menú nativo macOS** (desktop) — los comandos de formato/estructura muestran su accelerator.
- **Tooltips** — botones de topbar y sidebar muestran su shortcut.

---

## Navigate

| Acción | macOS | Windows / Linux | Runtime |
|---|---|---|---|
| Go to Desk | `⌘⌥1` | `Ctrl+Alt+1` | Both |
| Go to Workspace | `⌘⌥2` | `Ctrl+Alt+2` | Both¹ |
| Go to Studio *(soon)* | `⌘⌥3` | `Ctrl+Alt+3` | Both |
| Search | `⌘K` | `Ctrl+K` | Both |
| Next tab | `⌘⇧]` | `Ctrl+Shift+]` | Desktop |
| Previous tab | `⌘⇧[` | `Ctrl+Shift+[` | Desktop |
| New writing | `⌘N` | `Ctrl+N` | Desktop |

¹ Workspace es feature desktop-only; su entrada de navegación se oculta en web.

## Format

| Acción | macOS | Windows / Linux | Runtime |
|---|---|---|---|
| Bold | `⌘B` | `Ctrl+B` | Both |
| Italic | `⌘I` | `Ctrl+I` | Both |
| Strikethrough | `⌘⇧X` | `Ctrl+Shift+X` | Both |
| Highlight | `⌘⇧H` | `Ctrl+Shift+H` | Both |
| Inline code | `⌘E` | `Ctrl+E` | Both |
| Code block | `⌘⇧E` | `Ctrl+Shift+E` | Both |
| Insert link | `⌘⇧K` | `Ctrl+Shift+K` | Both |

## Structure

| Acción | macOS | Windows / Linux | Runtime |
|---|---|---|---|
| Paragraph | `⌘0` | `Ctrl+0` | Desktop |
| Heading 1 | `⌘1` | `Ctrl+1` | Desktop |
| Heading 2 | `⌘2` | `Ctrl+2` | Desktop |
| Heading 3 | `⌘3` | `Ctrl+3` | Desktop |
| Bulleted list | `⌘L` | `Ctrl+L` | Desktop |
| Numbered list | `⌘⇧L` | `Ctrl+Shift+L` | Both |
| Blockquote | `⌘⇧B` | `Ctrl+Shift+B` | Desktop |

## Insert

| Acción | macOS | Windows / Linux | Runtime |
|---|---|---|---|
| Footnote | `⌘⇧A` | `Ctrl+Shift+A` | Desktop |
| Table | `⌘T` | `Ctrl+T` | Desktop |
| Image | `⌘⇧I` | `Ctrl+Shift+I` | Desktop |
| Horizontal rule | `⌘⇧-` | `Ctrl+Shift+-` | Both |

## Annotate & Document

| Acción | macOS | Windows / Linux | Runtime |
|---|---|---|---|
| Add note | `⌘⇧N` | `Ctrl+Shift+N` | Desktop |
| Voice note (start / stop) | `⌘⌥R` | `Ctrl+Alt+R` | Both |
| Document properties | `⌘⌥P` | `Ctrl+Alt+P` | Both |
| Corrections | `⌘⌥S` | `Ctrl+Alt+S` | Both |

## Editor

| Acción | macOS | Windows / Linux | Runtime |
|---|---|---|---|
| Find | `⌘F` | `Ctrl+F` | Both |
| Replace | `⌘⌥F` | `Ctrl+Alt+F` | Both |
| Toggle focus mode | `⌘⇧F` | `Ctrl+Shift+F` | Both |
| Toggle sidebar | `⌘\` | `Ctrl+\` | Both |
| Open shortcut help | `⌘/` | `Ctrl+/` | Both |
| Open settings | `⌘,` | `Ctrl+,` | Both |

---

## Desktop File menu (nativo, macOS)

Items del menú nativo, fuera del mapa de shortcuts del editor:

| Acción | macOS |
|---|---|
| New File (en disco) | `⌘⌥N` |
| Open File… | `⌘O` |
| Save to Disk | `⌘S` |
| Save As… | `⌘⇧S` |
| Open DevTools | `⌘⌥I` |

> `⌘N` **no** está atado a "New File": se reserva para **New writing** (manejado en el webview). El flujo de "New File" en disco vive en `⌘⌥N`.

## Contrato de paridad

Si se cambia un shortcut en `lib/editor/shortcuts.ts`, el menú nativo de `src-tauri/src/lib.rs` y este documento deben actualizarse en el mismo cambio.
