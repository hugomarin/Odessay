---
name: skill-design/vistas
description: Companion file de skill-design. Valores exactos de padding, tamaños, colores y comportamiento por vista (Desk, Collections, Correspondences, Reading, Editor, Sidebar) + checklists de validación. Leer siempre junto a skills/skill-design/SKILL.md antes de implementar cualquier vista. No usar de forma standalone.
---

# Skill: Design — Vistas (Odessay)

Lee `skill-design.md` primero. Este documento asume que ya tienes los tokens de color, tipografía, sombras y reglas globales. Aquí solo viven los valores específicos de cada vista.

Los prototipos HTML en `/reference/` son la referencia visual canónica. Cuando hay conflicto entre un prototipo y este documento, este documento gana. Los prototipos pueden tener diferencias menores respecto al diseño final — este documento es la especificación oficial. Excepción conocida: ink-3/ink-4 en el editor (`reference/editor.html`) son más claros que el resto — usar los valores de `skill-design.md`.

El mapa completo de archivos de referencia y sus screenshots está en `CLAUDE.md` (sección: Prototipos visuales de referencia).

---

## Sidebar (todas las vistas)

### Logo
```
font-family: Lora
font-size: 17px
color: var(--ink)
En mini: opacity 0, width 0, overflow hidden
```

### Botón New writing
```
Estado normal: fondo transparente, texto ink, icono Plus
Estado mini:   32×32px, fondo var(--ink), color var(--bg), centrado
Hover:         fondo var(--muted-h)
border-radius: 8px
font-size: 15px, font-weight: 500
```

### Nav items
```
padding:       10px
border-radius: 8px
font-size:     15px
color normal:  var(--ink-2)
color active:  var(--ink), font-weight 500, background var(--muted)
hover:         background var(--muted-h), color var(--ink)
icono:         14×14px, strokeWidth 1.5, flex-shrink 0
En mini:       justify-content center, gap 0, label oculto
```

### Sub-items (colecciones y correspondencias)
```
padding:       7px 10px 7px 34px
border-radius: 8px
font-size:     13px
color:         var(--ink-3)
icono:         12×12px
```

### Chevron de expansión
```
color:      var(--ink-4)
rotación:   90deg cuando open
transición: 280ms cubic-bezier(0.4,0,0.15,1)
En mini:    display none
```

### User bar (bottom)
```
avatar:  28×28px, border-radius 50%, background var(--ink), color var(--bg), font 11px 600
nombre:  13px, font-weight 500
padding: 6px 8px
En mini: solo avatar centrado, nombre y chevron ocultos
```

---

## Desk (`/desk`)

```
Topbar (46px) — título "Desk"
Hero — cards horizontales deslizables (In progress)
Filter bar (46px) — filtros de actividad
Table — writings con actividad epistolar
```

### Hero — Draft cards
```
width:         220px fijo, scroll horizontal con snap
border-radius: 10px
card activo:   border-top: 2px solid var(--cursor)
status label:  10px uppercase ink-4 (activo: var(--cursor))
título:        Lora 15px, font-weight 500
excerpt:       Lora italic 12px, ink-3, 2 líneas clamp
footer:        meta (fecha · palabras), separado por border-top 0.5px
new writing:   border dashed, fondo transparente
```

### State badges (tabla de actividad)
```
New reply:  bg hsl(22,55%,92%)   color var(--cursor)
Waiting:    bg hsl(45,60%,91%)   color hsl(35,55%,32%)
Replied:    bg hsl(140,30%,91%)  color hsl(140,40%,32%)
Shared:     bg hsl(220,40%,92%)  color hsl(220,50%,40%)
Read:       bg var(--muted)      color var(--ink-4)
```

### Tabla de actividad
```
columnas:  · | Writing | State | With | Date
grupos:    Today / This week / Earlier — label uppercase 10px ink-4
filas:     padding 18px vertical
título:    Lora 15px
excerpt:   Geist Sans 12px, ink-3
dot:       6px, hsl(220,50%,55%) para items nuevos
```

### Filter buttons
```
off:           borde none, bg transparente, color ink-4
on:            bg var(--ink), color var(--bg)
hover:         bg var(--muted), color ink-2
height:        28px
border-radius: 7px
font-size:     12px
```

---

## Collections (`/collections`)

```
Topbar — "Collections" + "New collection" (btn tinta oscura)
Banner uncategorized — terracota tenue, expandible
Organize panel — writings sin clasificar (colapsable)
Collections list — colecciones expandibles
```

### Banner uncategorized
```
background:    hsl(22,55%,97%)
border:        0.5px solid hsl(22,40%,84%)
border-radius: 12px
AI strip:      fondo hsl(22,55%,95%), borde top 0.5px
```

### Organize panel — writing cards
```
grid:    checkbox (32px) | preview (1fr) | AI pill | col dropdown
excerpt: Lora 13px, 2 líneas clamp
filename: Geist Sans 11px, ink-4
meta:    fecha + palabras, 11px ink-4
AI pill: bg hsl(22,55%,93%), color var(--cursor), border hsl(22,40%,82%)
```

### Colecciones expandibles
```
border:         0.5px solid var(--border)
border-radius:  10px
header:         Geist Sans 13px, chevron, nombre, count badge
writing items:  padding 14px 16px 14px 40px
  título:       Lora 14px, font-weight 500
  excerpt:      Geist Sans 12px, ink-3, 1 línea clamp
  meta:         badge estado + fecha + palabras
transición:     max-height 0→2000px, 350ms ease-layout
```

### Status badges en writing items
```
Draft:  bg var(--muted)         color ink-4
Done:   bg hsl(140,30%,91%)     color hsl(140,40%,30%)
Shared: bg hsl(220,40%,92%)     color hsl(220,50%,40%)
```

---

## Correspondences (`/correspondences/:id`)

```
Topbar — back link | título | pill "Your turn"
Participants bar (46px) — avatares apilados, stats
Sequence — mini-documentos verticales
Reply prompt — acción fundacional
```

### Participants bar
```
avatares: 26px, border 2px solid var(--sb), margin-left -7px (apilados)
stats:    writings count | words total | desde cuándo
font:     Geist Sans 12-13px, ink-3/ink-4
```

### Mini-document cards
```
max-width:     560px, centrado en columna de 680px
border:        0.5px solid var(--border)
border-radius: 10px
sin borde izquierdo de color

avatar:        44px, border 3px solid var(--bg)

card top (padding 20px 24px 16px):
  byline:  Geist Sans 13px 600 ink-2 + badge "you"/"New" + fecha 12px ink-4
  título:  Lora 22px, font-weight 500
  excerpt: Geist Sans 14px, ink-2, 3 líneas clamp

card bottom (padding 12px 24px):
  words:      Geist Sans 12px, ink-3
  "Open":     Geist Sans 12px, ink-3 + icono ExternalLink
  background: transparente
```

### Connector entre cards
```
línea:  0.5px vertical, color var(--border)
altura: 24px entre cards
```

### Reply prompt
```
border:        0.5px dashed var(--border)
border-radius: 10px
hover:         border-color var(--cursor), background var(--sb)
texto:         Lora italic 14px, ink-4
botón:         "Write a response" — bg var(--cursor), color white
```

### Your turn pill
```
background:    hsl(22,55%,92%)
color:         var(--cursor)
font:          Geist Sans 11px, font-weight 500
border-radius: 13px
```

---

## Reading view

Sin sidebar. Pantalla completa, fondo `var(--bg)`.

### Chrome (46px)
```
back link: Geist Sans 13px ink-4
nav:       Previous | N of N | Next
tools:     Margins toggle | Write a response (btn terracota)
```

### Layout
```
Reading scroll (flex: 1) | Margin panel (0px → 296px, animado 300ms ease-layout)
```

### Contenido (max-width 660px, centrado)
```
author block: avatar 38px + nombre 14px + fecha 12px
              border-bottom 0.5px antes del texto

título:    Lora 30px, font-weight 500, letter-spacing -0.01em
body:      Geist Sans 17-18px, line-height 1.85
blockquote: border-left 2px ink-3, Lora italic 18px, padding-left 1.4em
```

### Highlights
```
default:       bg hsl(45,90%,84%)
hover:         bg hsl(45,90%,76%)
con anotación: border-bottom 1.5px solid hsl(35,80%,55%)
active:        bg hsl(45,90%,74%)
```

### Selection popup
```
background:    var(--ink)
border-radius: 10px
botones:       "Mark" | separator | "Annotate"
font:          Geist Sans 12px, font-weight 500, color var(--bg)
animación:     opacity + translateY(4px→0), 150ms
```

### Annotation bubble
```
background:    var(--sb)
border:        0.5px solid var(--border)
border-radius: 12px
width:         260px
shadow:        shadow-float-lg
posición:      debajo de la selección, dentro del viewport
```

### Margin panel (296px)
```
header:  46px — "Margins" label + count badge + "Share" link
entries: flex 1, scroll

margin entry:
  passage:          Lora italic 12px, ink-4
  note:             Geist Sans 13px, ink-2, textarea sin borde
  borde izquierdo:  ámbar cuando has-note, var(--cursor) cuando focused
  hover:            background var(--muted)

footer: "Share margins with..." — dashed border btn
```

---

## Editor (`/write/:id`)

Ver `odessay-editor.md` para la spec completa de TipTap (extensiones, shortcuts, auto-save, modales).

### Layout
```
Sidebar (292px/52px) | Editor area (flex-1) | Right panels (248-280px)
Topbar (46px) — sobre editor area
Statusbar (32px) — bajo editor area
```

### Topbar — tres columnas
```
left:   Mode toggle (Rich/Markdown) + format toolbar
center: Título del writing (editable, Lora, sin borde)
right:  Focus | Notes | AI | Properties — icon buttons 14×14px
```

### Right panels
```
Notes:      248px, writings de footnotes
AI Editor:  280px, observaciones del AI — ver odessay-ai-editor.md
Properties: 248px — Status, Visibility, Collections, correspondence card, Info
```

### Correspondence card (panel Properties)
```
background:    hsl(22,55%,97%)
border:        0.5px solid hsl(22,40%,85%)
border-radius: 9px
icono:         FileStack, color var(--cursor)
título:        Geist Sans 12px, font-weight 600
body:          Geist Sans 11px, ink-3
botón:         "Invite to respond" — bg var(--cursor), color white
```

---

## Checklist de validación por vista

Usar antes de mover un issue a In Review. Complementa el checklist de `skill-code-review.md`.

### Sidebar (todas las vistas)
- [ ] Expandido 292px exactos, colapsado 52px solo iconos centrados
- [ ] Transición width 300ms ease-layout
- [ ] Logo "Odessay" en Lora 17px
- [ ] Nav items: hover muted-h, active con muted y font-weight 500
- [ ] Sub-items indentados a 34px desde el borde izquierdo
- [ ] User bar: avatar 28px centrado en mini, nombre y chevron ocultos
- [ ] Todos los bordes 0.5px, ningún borde 1px

### Desk
- [ ] Hero: cards 220px, scroll horizontal con snap
- [ ] Card activo: border-top 2px var(--cursor)
- [ ] Tabla: grupos Today / This week / Earlier
- [ ] "All activity" activo por defecto (btn tinta oscura)
- [ ] Dot indicador 6px visible en items nuevos

### Collections
- [ ] Banner uncategorized visible cuando hay writings sin clasificar
- [ ] AI pill en terracota, aceptable con click
- [ ] Colecciones expandibles con chevron y animación suave
- [ ] Botón "New collection" en tinta oscura (no terracota)

### Correspondences
- [ ] Mini-docs centrados, max-width 560px
- [ ] Sin borde izquierdo de color en ningún card
- [ ] Título en Lora 22px
- [ ] Excerpt en Geist Sans 14px, ink-2, 3 líneas clamp
- [ ] Card bottom sin background (transparente)
- [ ] Connector line visible entre cards
- [ ] Reply prompt con botón terracota "Write a response"

### Reading
- [ ] Sin sidebar en ningún viewport
- [ ] Selection popup aparece al seleccionar texto
- [ ] Highlight en ámbar hsl(45,90%,84%)
- [ ] Annotation bubble posicionada bajo la selección, dentro del viewport
- [ ] Margin panel 296px, animado 300ms
- [ ] Highlights con borde inferior ámbar cuando tienen anotación
- [ ] Navegación keyboard: flechas entre writings, ESC cierra popup

### Editor
- [ ] Un keystroke no re-renderiza el sidebar ni paneles
- [ ] Título editable en Lora sin borde visible
- [ ] Panels (Notes / AI / Properties) con lazy load
- [ ] Statusbar visible, indicador de sync sutil
- [ ] Focus mode colapsa todo: sidebar, topbar, statusbar, panels
