# ODESSAY — Design Specification
**Para agentes de desarrollo frontend (Next.js / React)**
Versión 1.0 — Marzo 2026

> Este documento vive en `/mnt/skills/user/odessay-design/odessay-design-spec.md`
> Es referenciado por `skill-design.md` y `skill-frontend.md`.
> Leer completo antes de implementar cualquier vista.
> Para tokens, tipografía y componentes ShadCN → `skill-design.md`.
> Para arquitectura, naming, y estructura de archivos → `skill-frontend.md`.

Este documento es la fuente de verdad para implementar el frontend de Odessay. Los archivos HTML de referencia visual son prototipos — no copiar su código, sino usar sus valores y comportamientos como especificación.

---

## 1. Design Tokens

Implementar como CSS custom properties globales y como tema de Tailwind.

```ts
// theme.ts
export const tokens = {
  color: {
    bg:      'hsl(38, 12%, 98%)',   // fondo general de la app
    sb:      'hsl(0,  0%,  100%)',  // fondo del sidebar y cards
    muted:   'hsl(38, 8%,  93%)',   // fondos hover y badges neutros
    mutedH:  'hsl(38, 8%,  90%)',   // hover más pronunciado
    border:  'hsl(38, 8%,  90%)',   // todos los bordes
    ink:     'hsl(25, 18%, 10%)',   // texto principal
    ink2:    'hsl(25, 12%, 22%)',   // texto secundario
    ink3:    'hsl(25, 10%, 38%)',   // texto terciario / excerpts
    ink4:    'hsl(25, 8%,  52%)',   // texto muy secundario / labels
    cursor:  'hsl(22, 55%, 38%)',   // terracota — acento principal
  },
  font: {
    serif:   "'Lora', Georgia, serif",
    sans:    "system-ui, -apple-system, sans-serif",
  },
  radius: {
    sm:  '6px',   // badges, botones pequeños
    md:  '8px',   // nav items, inputs
    lg:  '10px',  // cards principales
    xl:  '12px',  // modales, panels grandes
    pill:'50px',  // pills de estado
    full:'50%',   // avatares
  },
  sidebar: {
    full: '292px',
    mini: '52px',
  },
  topbar: {
    height: '46px',
  },
  transition: {
    layout: 'cubic-bezier(0.4, 0, 0.15, 1)',
    hover:  '180ms ease',
    panel:  '300ms cubic-bezier(0.4, 0, 0.15, 1)',
  }
}
```

**Nota crítica:** El editor (v6) tiene `--ink-3: hsl(25,8%,50%)` y `--ink-4: hsl(25,6%,65%)` — valores más claros que el resto de vistas. El valor correcto para toda la app es el de las vistas más recientes: `ink-3: hsl(25,10%,38%)` y `ink-4: hsl(25,8%,52%)`. El editor debe actualizarse al implementarse.

---

## 2. Tipografía

### Fuentes
```css
/* Google Fonts — importar en layout.tsx */
@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;1,400&display=swap');
```

### Escala tipográfica validada

| Elemento | Familia | Tamaño | Peso | Notas |
|---|---|---|---|---|
| Logo "Odessay" | Lora | 17px | 400 | Sidebar top |
| Título de vista | Lora | 15px | 400 | Topbar center |
| Nav items sidebar | system-ui | 15px | 400/500 | 500 cuando active |
| Nombre de usuario | system-ui | 13px | 500 | Sidebar bottom |
| Writing title (editor) | Lora | 36px | 500 | Editable en topbar |
| H1 en escritura | Lora | 30px | 500 | |
| H2 en escritura | Lora | 24px | 500 | |
| H3 en escritura | Lora | 20px | 500 | |
| Body del editor | system-ui | 18px | 400 | line-height: 1.85 |
| Blockquote | Lora | 22px | 400 italic | |
| Card título (correspondence) | Lora | 22px | 500 | |
| Card excerpt | system-ui | 14px | 400 | color: ink-2 |
| Reading title | Lora | 30px | 500 | line-height: 1.2 |
| Reading body | system-ui | 17-18px | 400 | line-height: 1.85 |
| Labels uppercase | system-ui | 10-11px | 600 | letter-spacing: 0.07em |
| Badges | system-ui | 10-12px | 500 | |
| Fechas / meta | system-ui | 11-12px | 400 | color: ink-4 |

**Regla:** Títulos y contenido epistolar en Lora. Todo lo funcional (labels, badges, meta, UI) en system-ui.

---

## 3. Layout global

```
┌─────────────────────────────────────────────┐
│ Sidebar (292px / 52px mini)  │  Main content │
│                              │               │
│  ┌─ Top: logo + toggle      │  ┌─ Topbar    │
│  ├─ Actions: new + search   │  ├─ Content   │
│  ├─ Nav: scroll area        │  └─ ...       │
│  └─ Bottom: user bar        │               │
└─────────────────────────────────────────────┘
```

### Sidebar
- **Expandido:** 292px — rail de 52px + 240px de contenido con texto
- **Colapsado (mini):** 52px — solo iconos, texto con `opacity: 0` + `width: 0`
- **Transición:** 300ms `cubic-bezier(0.4, 0, 0.15, 1)`
- **Background:** `--sb` (blanco)
- **Border right:** `0.5px solid var(--border)`

### Topbar
- **Altura:** 46px — invariable en todas las vistas
- **Border bottom:** `0.5px solid var(--border)`
- **Background:** `var(--bg)`

### Border
- Siempre `0.5px solid var(--border)` — nunca 1px
- Separadores internos también `0.5px`

---

## 4. Componentes del Sidebar

### Logo
```
font-family: Lora
font-size: 17px
color: var(--ink)
En mini: opacity 0, width 0, overflow hidden
```

### Botón New writing
```
Estado normal: fondo transparente, texto ink, icono +
Estado mini: 32×32px, fondo var(--ink), color blanco, centrado
Hover: fondo var(--muted-h)
Border-radius: 8px
Font-size: 15px, font-weight: 500
```

### Nav items
```
Padding: 10px
Border-radius: 8px
Font-size: 15px
Color normal: var(--ink-2)
Color active: var(--ink), font-weight: 500, background: var(--muted)
Hover: background var(--muted-h), color var(--ink)
Icono: 14×14px, flex-shrink: 0
En mini: justify-content center, padding 10px, gap 0, label oculto
```

### Sub-items (colecciones y correspondencias)
```
Padding: 7px 10px 7px 34px (indentado)
Border-radius: 8px
Font-size: 13px
Color: var(--ink-3)
Icono: 12×12px
```

### Chevron de expansión
```
Color: var(--ink-4)
Rotación: 90deg cuando open
Transición: 280ms cubic-bezier(0.4,0,0.15,1)
En mini: display none
```

### User bar (bottom)
```
Avatar: 28×28px, border-radius 50%, background var(--ink), color white, font 11px 600
Nombre: 13px, font-weight 500
Padding: 6px 8px
En mini: solo avatar centrado, nombre y chevron ocultos
```

### Iconos del sidebar
| Sección | Icono Lucide |
|---|---|
| Desk | `LayoutGrid` (4 cuadros) |
| Collections | `BookMarked` (estantes) |
| Correspondences | `FileStack` (docs apilados) |
| Shared | `Share2` (nodos conectados) |
| Search | `Search` |
| Recent writings | `PenLine` |

---

## 5. Vistas

### 5.1 Desk (`/desk`)

**Estructura:**
```
Topbar (46px) — título "Desk"
Hero (In progress) — cards horizontales deslizables
Filter bar (46px) — filtros de actividad
Table — writings con actividad epistolar
```

**Hero — Draft cards:**
- Width: 220px fijo, scroll horizontal con snap
- Border-radius: 10px
- Card activo: `border-top: 2px solid var(--cursor)`
- Status label: 10px, uppercase, ink-4 (activo: cursor)
- Título: Lora 15px, font-weight 500
- Excerpt: Lora italic 12px, ink-3, 2 líneas clamp
- Footer: meta (fecha · palabras) separado por border-top
- New writing card: border dashed, fondo transparente

**Tabla de actividad:**
- Columnas: · | Writing | State | With | Date
- Grupos por fecha: Today / This week / Earlier — header con label uppercase
- Filas: padding 18px vertical
- Bordes de separación: solo en columnas de contenido, no en dot column
- Título en fila: Lora 15px
- Excerpt en fila: system-ui 12px, ink-3

**State badges:**
```
New reply:  bg hsl(22,55%,92%)  color cursor    (terracota)
Waiting:    bg hsl(45,60%,91%)  color hsl(35,55%,32%)  (ámbar)
Replied:    bg hsl(140,30%,91%) color hsl(140,40%,32%) (verde)
Shared:     bg hsl(220,40%,92%) color hsl(220,50%,40%) (azul)
Read:       bg var(--muted)     color var(--ink-4)      (neutro)
```

**Filter buttons:**
```
Estado off: borde none, bg transparente, color ink-4
Estado on:  bg var(--ink), color white
Hover: bg var(--muted), color ink-2
Height: 28px, border-radius: 7px, font-size: 12px
```

---

### 5.2 Collections (`/collections`)

**Estructura:**
```
Topbar — "Collections" + "New collection" (btn primary)
Banner uncategorized — terracota tenue, expandible
Organize panel — lista de writings sin clasificar (colapsable)
Collections list — colecciones expandibles
```

**Banner uncategorized:**
```
Background: hsl(22,55%,97%)
Border: 0.5px solid hsl(22,40%,84%)
Border-radius: 12px
AI suggestion strip: fondo hsl(22,55%,95%), borde top
```

**Organize panel — writing cards:**
```
Grid: checkbox (32px) | preview (1fr) | AI suggest pill | col dropdown
Excerpt: Lora 13px, 2 líneas
Filename: system-ui 11px, ink-4
Meta: fecha + palabras, 11px ink-4
AI pill: bg hsl(22,55%,93%), color cursor, border hsl(22,40%,82%)
```

**Colecciones expandibles:**
```
Border: 0.5px solid var(--border)
Border-radius: 10px
Header: 13px, chevron, nombre, count badge
Writing items: padding 14px 16px 14px 40px (indentado)
  Título: Lora 14px, font-weight 500
  Excerpt: system-ui 12px, ink-3, 1 línea clamp
  Meta: badge estado + fecha + palabras
Transición expand: max-height 0 → 2000px, 350ms ease-layout
```

**Botones de estado en writing items:**
```
Draft:  bg var(--muted),         color ink-4
Done:   bg hsl(140,30%,91%),     color hsl(140,40%,30%)
Shared: bg hsl(220,40%,92%),     color hsl(220,50%,40%)
```

---

### 5.3 Correspondences (`/correspondences`)

**Vista lista:** — pendiente de diseño

**Vista de hilo (`/correspondences/:id`):**
```
Topbar — back link | título de la correspondencia | pill "Your turn"
Participants bar (46px) — avatares apilados, nombres, stats
Sequence — lista vertical de mini-documentos
```

**Participants bar:**
```
Avatares: 26px, border 2px solid var(--sb), margin-left -7px (apilados)
Stats: writings count | words total | desde cuándo
Font: system-ui 12-13px, ink-3/ink-4
```

**Mini-document cards:**
```
Max-width: 560px, centrado a 680px en la lista
Border: 0.5px solid var(--border)
Border-radius: 10px
Sin borde izquierdo de color
Avatar: 44px, border 3px solid var(--bg)

Card top (padding 20px 24px 16px):
  Byline: autor (13px 600 ink-2) + badge "you"/"New" + fecha (12px ink-4)
  Título: Lora 22px, font-weight 500
  Excerpt: system-ui 14px, ink-2, 3 líneas clamp

Card bottom (padding 12px 24px):
  Words: 12px, ink-3
  "Open to read": 12px, ink-3 con icono external-link
  Sin background (transparente)
```

**Connector entre cards:**
```
Línea vertical: 0.5px, color var(--border)
Altura: 24px entre cards
```

**Reply prompt:**
```
Border: 0.5px dashed var(--border)
Border-radius: 10px
Hover: border-color var(--cursor), background white
Texto: Lora italic 14px, ink-4
Botón "Write a response": bg var(--cursor), color white — acción fundacional
```

**Your turn pill:**
```
Background: hsl(22,55%,92%)
Color: var(--cursor)
Font: system-ui 11px, font-weight 500
Border-radius: 13px
```

---

### 5.4 Reading view

**Sin sidebar.** Pantalla completa, fondo `var(--bg)`.

**Chrome (46px):**
```
Back link: 13px ink-4
Nav: Previous | N of N | Next
Tools: Margins (toggle) | Write a response (cursor button)
```

**Layout:**
```
Reading scroll (flex: 1) | Margin panel (0px → 296px, animado)
```

**Contenido (max-width 660px, centrado):**
```
Author block: avatar 38px + nombre 14px + fecha 12px
  Separado del texto por border-bottom 0.5px

Título: Lora 30px, font-weight 500, letter-spacing -0.01em
Body: system-ui 17-18px, line-height 1.85
Blockquote: border-left 2px ink-3, Lora italic 18px, padding-left 1.4em
```

**Highlights:**
```
Background: hsl(45,90%,84%)
Hover: hsl(45,90%,76%)
Con anotación: border-bottom 1.5px solid hsl(35,80%,55%)
Active (focused): hsl(45,90%,74%)
```

**Selection popup:**
```
Background: var(--ink) (negro)
Border-radius: 10px
Botones: "Mark" | separator | "Annotate"
Font: system-ui 12px, font-weight 500, color white
Animación: opacity + translateY(4px→0), 150ms
```

**Annotation bubble:**
```
Background: var(--sb)
Border: 0.5px solid var(--border)
Border-radius: 12px
Width: 260px
Shadow: 0 8px 32px hsla(25,18%,12%,0.1)
Posición: debajo de la selección, dentro del viewport
```

**Margin panel (296px):**
```
Header: 46px — "Margins" label + count badge + "Share" link
Entries scroll: flex 1
Footer: "Share margins with..." — dashed border btn

Margin entry:
  Passage: Lora italic 12px, ink-4
  Note: textarea system-ui 13px, ink-2, sin borde
  Borde izquierdo ámbar cuando has-note
  Borde izquierdo cursor cuando focused
  Hover: background var(--muted)
```

---

### 5.5 Editor (`/write`, `/write/:id`)

Ver `odessay-editor.md` para spec completa del editor TipTap.

**Layout:**
```
Sidebar (292px/52px) | Topbar (46px) | Editor area | Right panels (248-280px)
```

**Topbar — tres columnas:**
```
Left: Mode toggle (Rich/Markdown) + format toolbar
Center: Título del writing (editable, Lora)
Right: Focus | Notes | AI | Properties (icon buttons)
```

**Right panels:**
- Notes: 248px, writings de footnotes
- AI Editor: 280px, observaciones del AI
- Properties: 248px — Status, Visibility, Collections, correspondence card, Info

**Correspondence card (en Properties panel):**
```
Background: hsl(22,55%,97%)
Border: 0.5px solid hsl(22,40%,85%)
Border-radius: 9px
Icono: FileStack, color cursor
Título: 12px, font-weight 600
Body: 11px, ink-3
Botón "Invite to respond": bg var(--cursor), color white — acción fundacional
```

---

## 6. Convención de color en botones

Odessay usa **dos colores de botón primario** con semántica distinta:

### Tinta oscura `var(--ink)` — acciones funcionales
Para acciones cotidianas: confirmar, guardar, insertar, añadir.
```css
background: var(--ink);
color: var(--bg);
```

### Terracota `var(--cursor)` — acciones fundacionales
Para acciones que inician algo con peso semántico: iniciar correspondencia, publicar por primera vez, invitar a responder, escribir una respuesta.
```css
background: var(--cursor); /* hsl(22, 55%, 38%) */
color: white;
```

**Regla:** No usar dos botones del mismo color en el mismo modal. No usar terracota para acciones frecuentes — dilluye el peso semántico.

---

## 7. Los tres modos de Odessay

El producto tiene tres modos con interfaces distintas:

| Modo | Ruta | Propósito | Tono de interfaz |
|---|---|---|---|
| **Escribir** | `/write/:id` | Crear | Interface desaparece, texto protagonista |
| **Leer** | Vista de lectura | Recibir | Chrome mínimo, tipografía protagonista |
| **Organizar** | `/desk`, `/collections` | Gestionar | Funcional, tabla, filtros |

**Confundir estos modos produce interfaces incorrectas.** Collections no es para leer — es para organizar. Correspondences es una interfaz de lectura, no de escritura.

---

## 8. Checklist de validación por vista

### Sidebar (todas las vistas)
- [ ] Expandido: 292px exactos
- [ ] Colapsado: 52px, solo iconos centrados
- [ ] Transición: 300ms ease-layout
- [ ] Logo "Odessay" en Lora 17px
- [ ] Nav items: 15px, hover muted-h, active con muted y font-weight 500
- [ ] Sub-items indentados a 34px desde el borde
- [ ] User bar: avatar 28px centrado en mini, nombre y chevron ocultos en mini
- [ ] Todos los bordes: 0.5px (nunca 1px)

### Desk
- [ ] Hero: cards de 220px, scroll horizontal con snap
- [ ] Card activo: border-top 2px cursor
- [ ] Tabla: grupos Today/This week/Earlier
- [ ] Filtros: "All activity" activo por defecto en tinta oscura
- [ ] Dot indicador: 6px, hsl(220,50%,55%) para items nuevos

### Collections
- [ ] Banner uncategorized siempre visible si hay writings sin clasificar
- [ ] AI pill en cada writing: terracota, aceptable con click
- [ ] Colecciones expandibles con chevron y animación suave
- [ ] Botón New collection: primary (tinta oscura)

### Correspondences
- [ ] Mini-docs centrados, max-width 560px
- [ ] Sin borde izquierdo de color en ningún card
- [ ] Título en Lora 22px
- [ ] Excerpt en system-ui 14px, ink-2
- [ ] Card bottom sin background
- [ ] Connector line entre cards
- [ ] Reply prompt con botón terracota

### Reading
- [ ] Sin sidebar
- [ ] Selection popup aparece al seleccionar >6 palabras
- [ ] Highlight en ámbar hsl(45,90%,84%)
- [ ] Annotation bubble posicionada bajo la selección
- [ ] Margin panel: 296px, animado
- [ ] Highlights con borde inferior ámbar cuando tienen anotación
- [ ] Navegación con flechas de teclado y ESC

---

## 9. Archivos de referencia visual

| Archivo | Vista | Notas |
|---|---|---|
| `odessay-editor-v6.html` | Editor completo | ink-3/ink-4 desactualizados vs resto |
| `odessay-workspace-v3.html` | Desk | Referencia correcta |
| `odessay-collections.html` | Collections | Referencia correcta |
| `odessay-correspondence-v2.html` | Correspondence hilo | Referencia correcta |
| `odessay-reading-margins.html` | Reading + Margins | Sin sidebar — standalone |

**Inconsistencia a resolver en implementación:** El editor usa `ink-3: hsl(25,8%,50%)` e `ink-4: hsl(25,6%,65%)`. Todos los demás usan `ink-3: hsl(25,10%,38%)` e `ink-4: hsl(25,8%,52%)`. Usar los valores más recientes (mayor contraste) en toda la implementación.

