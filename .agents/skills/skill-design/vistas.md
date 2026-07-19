---
name: skill-design/vistas
description: Companion file de skill-design. Valores exactos de padding, tamaños, colores y comportamiento por vista (Desk, Collections, Correspondences, Reading, Editor, Sidebar) + checklists de validación. Leer siempre junto a .agents/skills/skill-design/SKILL.md antes de implementar cualquier vista. No usar de forma standalone.
---

# Skill: Design — Vistas (Odessay)

Lee `skill-design.md` primero. Este documento asume que ya tienes los tokens de color, tipografía, sombras y reglas globales. Aquí solo viven los valores específicos de cada vista.

Los prototipos HTML en `/workflow/reference/` son la referencia visual canónica. Cuando hay conflicto entre un prototipo y este documento, este documento gana. Los prototipos pueden tener diferencias menores respecto al diseño final — este documento es la especificación oficial. Excepción conocida: ink-3/ink-4 en el editor (`workflow/reference/editor.html`) son más claros que el resto — usar los valores de `skill-design.md`.

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
columnas:  checkbox | Writing | Status | Type | Workspace | actions
grupos:    Today / This week / Earlier — label uppercase 10px ink-4
filas:     padding 24px vertical; checkbox alineado con la primera línea del título
título:    Geist Sans 15px, font-weight 600 (decisión ODE-382; sustituye Lora en estas filas funcionales)
jerarquía: título + estado + acciones forman un grupo adyacente; el título no ocupa el espacio restante
excerpt:   Geist Sans 13px, ink-3, clamp 2 líneas
estado:    badge icon-only relleno, rounded-square; color semántico del DocumentState
chips:     collection con icono Tag, borde 0.5px y fondo papel cálido
meta:      fecha y collections forman un stack con gap 6px; el chip no agrega padding superior propio
controles: Status / Type / Workspace, height 40px, anchos mínimos consistentes
paridad:   Desk y Workspace reutilizan el mismo HTML base de Writing (ArtifactWritingCell)
handoff:   Workspace reutiliza también el checkbox y las acciones rename/preview/collections;
           mientras ODE-381 no conecte sus mutaciones, se muestran disabled y con copy accesible
           de "coming soon". El excerpt conserva su slot visual sin fingir datos del filesystem.
responsive: Writing es la columna elástica; controles conservan min-width. Bajo el ancho útil,
            overflow-x queda dentro del wrapper de tabla, nunca en la página; no ocultar columnas
            ni convertir filas a cards.
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

### Contrato textual compartido (`write`/`preview`/`shared`/`public`)

```
regla:          misma semántica de presentación textual entre superficies
tables:         ancho mínimo del contenedor + expansión de columnas + scroll horizontal interno
pre/code:       multilinea cuando excede ancho; no overflow horizontal global de página
urls largas:    wrap consistente (break controlado), sin desbordar viewport
wrappers:       permitidos por superficie (ej. tableWrapper), pero mapeados al mismo contrato visual
```

Referencia obligatoria: `.agents/skills/skill-design/tipografia.md` (fuente de verdad del contrato tipográfico canónico).

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
Find & Replace bar (0px → 40px / 80px) — bajo topbar, sobre el contenido
Statusbar (32px) — bajo editor area
```

### Topbar — una sola barra de 46px

La barra única combina tabs de navegación (izquierda) y herramientas (derecha). No hay título centrado — el título vive en el tab activo. El toggle Rich/Md se queda en la statusbar.

```
[tabs elásticos + +]  |  [B] [I] [S] [Highlight] [Link] [H1] [H2] [H3]  |  [Focus] [Notes] [AI] [Polish] [Properties]
```

**Tabs (izquierda, flex: 1)**

```
Contenedor: flex: 1, min-width: 0, overflow: hidden

Cada tab:
  flex:          1                  — se reparten el espacio por igual
  min-width:     64px               — mínimo antes de truncar con ellipsis
  max-width:     180px              — cap para tabs con título corto
  height:        46px (full bar)
  padding:       0 10px 0 12px
  border-right:  0.5px solid var(--border)
  font:          Geist Sans 13px, color var(--ink-4)

Estado inactive:
  background:  transparent
  color:       var(--ink-4)
  hover:       background var(--muted), color var(--ink-2)
  × en hover:  opacity 0 → 1, 100ms

Estado active:
  background:  var(--bg)      — mismo que el área de escritura, "conecta" visualmente
  color:       var(--ink), font-weight 500
  línea inferior: 1.5px solid var(--ink), position absolute bottom

× (cerrar tab):
  tamaño:      16×16px, border-radius 4px
  color:       var(--ink-4); hover: bg var(--muted-h), color var(--ink)
  visibilidad: opacity 0 por defecto, 1 en hover del tab
  posición:    margin-left auto (pegado a la derecha dentro del tab)

Punto • (unsaved):
  tamaño:      6×6px, border-radius 50%
  color:       var(--cursor)
  posición:    margin-left auto (mismo lugar que ×)
  comportamiento: visible en reposo; en hover del tab se oculta y aparece el ×

Botón +:
  width:         38px fijo, flex-shrink 0
  border-right:  0.5px solid var(--border)
  color:         var(--ink-4); hover bg var(--muted), color var(--ink)
  font-size:     20px, font-weight 300

Comportamiento elástico:
  Con 1–4 tabs:  llegan a max-width 180px, espacio sobrante queda vacío
  Con 5–8 tabs:  cada tab obtiene su parte proporcional del espacio disponible
  Con 9–10 tabs: comprimen hasta min-width 64px con ellipsis en el título
  Límite blando:  advertir al abrir el tab 11
```

**Format tools + panel icons (derecha, flex-shrink: 0)**

```
Separados del área de tabs con border-left: 0.5px solid var(--border)
padding: 0 8px, gap: 1px

Format tools (mismo estilo que antes):
  B  I  S  |  Highlight  Link  |  H1  H2  H3

Panel icons (30×30px, border-radius 6px):
  Focus | Notes | AI | Polish (Sparkles) | Properties

Polish usa ícono Sparkles (Lucide). Activo: background var(--muted), color var(--ink).
Todos los iconos: color var(--ink-4); hover background var(--muted), color var(--ink).
```

**Rich/Md toggle**

Se elimina del topbar. Vive en la statusbar (derecha), igual que hoy.

### Find & Replace bar

Referencia visual: iA Writer. Barra anclada directamente bajo el topbar, full width del área de edición (no sobre el texto como floating). Empuja el contenido hacia abajo — no hace overlay.

**Anatomía — dos filas**

```
Fila 1 — Buscar (siempre visible cuando el panel está abierto):
  height:        40px
  background:    var(--sb)
  border-bottom: 0.5px solid var(--border)
  padding:       0 12px
  layout:        flex, align-center, gap 8px

  [ campo de búsqueda (flex-1) ]  [ counter ]  [ < ]  [ > ]  [ "Replace" toggle ]

Campo de búsqueda:
  font:          Geist Sans 13px, color var(--ink)
  placeholder:   "Find…" — color var(--ink-4)
  background:    transparent
  border:        none, sin outline — el foco lo da la barra completa
  caret:         var(--cursor)

Counter (inline, al final del campo):
  Geist Sans 11px, color var(--ink-4)
  formato:       "12" cuando sin selección activa, "3 of 12" cuando navegando
  Al hacer ×:    limpia el campo y cierra el panel
  ×:             icon X 12px, color var(--ink-4), hover var(--ink)

Flechas de navegación < >:
  ChevronLeft / ChevronRight — Lucide, 14×14px, strokeWidth 1.5
  color:         var(--ink-3), hover var(--ink)
  disabled:      var(--ink-4), no-pointer

Toggle "Replace":
  Geist Sans 12px, color var(--ink-4)
  activo:        color var(--ink), font-weight 500
  padding:       4px 6px, border-radius 6px
  hover:         background var(--muted)
  Actúa como botón, no como checkbox — click muestra/oculta la fila 2

Fila 2 — Reemplazar (visible solo cuando "Replace" está activo):
  height:        40px
  background:    var(--sb)
  border-bottom: 0.5px solid var(--border)
  padding:       0 12px
  layout:        flex, align-center, gap 8px

  [ campo replace (flex-1) ]  [ "Replace" btn ]  [ "All" btn ]  [ "Done" btn ]

Campo replace:
  mismo estilo que campo de búsqueda
  placeholder:   "Replace with…"

Botones:
  "Replace":  Geist Sans 12px, color var(--ink-2), padding 4px 10px,
              border: 0.5px solid var(--border), border-radius 6px, hover bg var(--muted)
  "All":      mismo estilo que "Replace"
  "Done":     Geist Sans 12px, font-weight 500, color var(--ink-4), sin borde
              hover: color var(--ink)
```

**Apertura y cierre**

```
Cmd+F / Ctrl+F   → abre fila 1, foco en campo de búsqueda
Cmd+H / Ctrl+H   → abre fila 1 + fila 2
Escape           → cierra todo el panel, limpia highlights, foco vuelve al editor
Animación:       height 0→40px (o 0→80px) con overflow hidden, 150ms ease-out
```

**Highlights de coincidencias en el texto**

```
Coincidencias inactivas:  bg hsl(45,90%,84%) — mismo ámbar que highlights de márgenes
Coincidencia activa:      bg hsl(45,90%,60%) — más saturado/oscuro, distinguible
                          + outline 1.5px solid hsl(35,80%,55%)
Sin resultados:           campo de búsqueda color hsl(0,72%,51%) — destructive
                          counter muestra "0"
```

**Comportamiento mientras el panel está abierto**

```
El autor puede hacer clic en el área de escritura sin cerrar el panel.
El panel no captura el foco del editor — escritura sigue funcionando.
Al escribir en el editor con el panel abierto: re-busca con debounce 150ms.
```

### Right panels

```
Notes:      248px, writings de footnotes
AI Editor:  280px, observaciones del AI — ver odessay-ai-editor.md
Pulir:      280px — opciones + análisis AI + resultados
Properties: 248px — Status, Visibility, Collections, correspondence card, Info
```

### Panel Pulir (280px)

Panel de preparación para publicación. Se abre desde el icono Sparkles en la topbar.

**Header (46px)**

```
label:    "Polish" — Geist Sans 13px, font-weight 600, ink
close:    X — icon 14×14px, ink-4, hover ink
```

**Sección de opciones**

```
label de sección:  "REVISAR" — Geist Sans 10px, font-weight 500, ink-4, uppercase, letter-spacing 0.08em
                   Mismo estilo que "STATUS", "VISIBILITY" en Properties panel

4 opciones con toggle ShadCN Switch:
  · Ortografía      — Geist Sans 13px, ink-2
  · Redacción       — Geist Sans 13px, ink-2
  · Frases largas   — Geist Sans 13px, ink-2
  · Formato         — Geist Sans 13px, ink-2

Cada fila: flex justify-between, padding 8px 16px
Switch: tamaño sm (ShadCN default), checked bg var(--ink)
Todas las opciones activas por default al abrir el panel
```

**Botón Analizar**

```
margin:        16px (horizontal)
width:         calc(100% - 32px)
height:        34px
background:    var(--ink)
color:         var(--bg)
border-radius: 8px
font:          Geist Sans 13px, font-weight 500
label default: "Analyze"
label loading: "Analyzing…" + spinner 12px inline-left
```

**Estado de carga (mientras AI procesa)**

```
El botón cambia a "Analizando…" + spinner, deshabilitado.
Debajo del botón: skeleton de 3 sugerencias con animate-pulse:
  cada skeleton: height 56px, border-radius 8px, bg var(--muted), margin 8px 16px
No mostrar ningún mensaje adicional — el skeleton es suficiente.
```

**Estado de error**

```
Debajo del botón: toast inline (no global):
  background:    hsl(0,72%,97%)
  border:        0.5px solid hsl(0,72%,85%)
  border-radius: 8px
  margin:        0 16px
  padding:       10px 12px
  icon:          AlertCircle 12px, color hsl(0,72%,51%)
  texto:         Geist Sans 12px, ink-2 — "Could not analyze the text."
  botón:         "Try again" — Geist Sans 12px, color var(--cursor), sin fondo
```

**Resultados — secciones expandibles**

Las tres secciones (Ortografía/Gramática, Redacción, Checklist) solo aparecen cuando hay resultados. Cada una es un acordeón con el mismo patrón que las collections expandibles.

```
header de sección:
  padding:       12px 16px
  font:          Geist Sans 12px, font-weight 600, ink-2
  chevron:       ink-4, rotación 90deg cuando open, 280ms cubic-bezier
  count badge:   Geist Sans 11px, bg var(--muted), color ink-3, border-radius 10px, padding 1px 6px

Sección Ortografía/Gramática:
  Una sugerencia por fila:
    padding:       10px 16px
    texto original: Lora 13px, tachado, color ink-4
    texto sugerido: Geist Sans 13px, color hsl(140,40%,32%) — mismo verde que badge Done
    botones:       "Accept" (ink, font-weight 500) | "Ignore" (ink-4) — Geist Sans 12px

Sección Redacción:
  Una sugerencia por bloque:
    padding:       10px 16px
    etiqueta:      pill con motivo — "Claridad" / "Fluidez" / "Redundancia"
                   bg var(--muted), color ink-3, Geist Sans 10px uppercase
    fragmento:     Geist Sans 12px, ink-3, 2 líneas clamp, Lora italic para la cita original
    botones:       "View suggestion" → expande diff inline | "Ignore"

Sección Checklist:
  Lista de ítems accionables:
    · Checkbox ShadCN (unchecked default, checked al resolver)
    · Texto: Geist Sans 12px, ink-2
    · Link "Ir" en terracota cuando hay ubicación específica
```

**Footer — acciones globales**

```
border-top:  0.5px solid var(--border)
padding:     12px 16px
flex row, gap 8px

"Apply all"  — bg var(--ink), color var(--bg), border-radius 8px, height 30px, Geist Sans 12px 500
"Re-analyze"    — border 0.5px solid var(--border), bg transparent, color ink-2, mismas dimensiones
```

**Estado vacío (sin resultados)**

```
padding:     32px 16px
text-align:  center
icono:       CheckCircle2 20px, color hsl(140,40%,45%)
texto:       "Looking good." — Geist Sans 13px, ink-2
subtexto:    Lora italic 12px, ink-4 — "No issues found with the selected checks."
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

## Transactional email templates

Referencia visual: emails de Claude (Anthropic). Diseño minimalista centrado, sin imágenes decorativas, un solo CTA negro.

```
Container:     max-width 560px, margin auto, fondo blanco (#FFFFFF)
Padding outer: 40px arriba/abajo, 0 lateral (el cliente de email lo maneja)
Padding inner: 0 40px en el contenido
```

**Estructura de cada template**

```
1. Header
   wordmark:    "Odessay" — Lora, 20px, font-weight 500, color #1C1612
               centrado, padding-top 40px, padding-bottom 32px
   separator:  border-bottom 1px solid #E8E7E4

2. Body
   padding:    32px 40px
   text-align: center

   título:     Lora, 22px, font-weight 500, color #1C1612
               line-height 1.4, margin-bottom 16px

   cuerpo:     font-family: Georgia, 'Times New Roman', serif (web-safe fallback de Lora)
               — alternativa sans: Arial, Helvetica, sans-serif
               font-size: 15px, line-height 1.7
               color: #695E59 (ink-3 en hex)
               margin-bottom 24px

   Nota: NO cargar fuentes externas (@font-face / Google Fonts) — mala compatibilidad
         con Outlook. Usar Georgia como serif y Arial como sans-serif.

3. CTA button
   display:        inline-block (centrado con text-align: center en el wrapper)
   background:     #1C1612  (ink en hex — negro tipográfico Odessay)
   color:          #FAF9F7  (bg en hex)
   padding:        12px 28px
   border-radius:  8px
   font-family:    Arial, Helvetica, sans-serif
   font-size:      14px, font-weight: bold
   text-decoration: none
   margin-bottom:  24px

4. Secondary text (si aplica)
   font-size:  12px, color #8C837E (ink-4 en hex)
   text-align: center, line-height 1.6

5. Footer
   border-top:  1px solid #E8E7E4
   padding:     24px 40px
   font-size:   11px, color #8C837E
   text-align:  center
   contenido:   © {año} Odessay · link "Gestionar notificaciones" (stub)

   Nota: NO incluir dirección física. Los emails de Odessay son
   transaccionales (signup, recovery, email change, reauth) y están
   exentos del requisito CAN-SPAM de address-physical, que aplica
   solo a comunicaciones comerciales/marketing.
```

**Tokens HSL → HEX (para usar en emails)**

```
--ink    hsl(25,18%,10%)  →  #1C1612
--ink-2  hsl(25,12%,22%)  →  #3D3530
--ink-3  hsl(25,10%,38%)  →  #695E59
--ink-4  hsl(25, 8%,52%)  →  #8C837E
--bg     hsl(38,12%,98%)  →  #FAF9F7
--border hsl(38, 8%,90%)  →  #E8E7E4
--cursor hsl(22,55%,38%)  →  #943D1F
```

**No usar:** dark mode media queries, gradientes, imágenes de fondo, tablas anidadas complejas.

---

## Settings (`/settings`)

Referencia visual: Claude settings. Dos columnas: nav lateral izquierda + contenido derecho.

```
Layout: flex row, sin sidebar global de Odessay (pantalla completa)
        o con sidebar de Odessay colapsado en mini (52px)

Nav lateral:
  width:       180px, flex-shrink 0
  padding:     24px 12px
  border-right: 0.5px solid var(--border)

  Título "Settings":
    font: Lora 17px, font-weight 500, color var(--ink)
    padding: 0 8px, margin-bottom 20px

  Nav items:
    padding:       8px 10px
    border-radius: 8px
    font-size:     14px, color var(--ink-3)
    hover:         background var(--muted), color var(--ink-2)
    active:        background var(--muted), color var(--ink), font-weight 500

  Secciones Fase 3 (pocas opciones):
    · Account    → email, contraseña, username, display name
    · Privacy    → futuro
    · Billing    → futuro

Área de contenido:
  max-width:   640px
  padding:     32px 40px
  overflow-y:  auto

  Section header:
    font: Geist Sans 16px, font-weight 600, color var(--ink)
    margin-bottom: 24px
    border-bottom: 0.5px solid var(--border), padding-bottom 12px

  Field group:
    margin-bottom: 24px
    label:  Geist Sans 12px, font-weight 500, color var(--ink-2), margin-bottom 6px
    input:  ShadCN Input, ancho completo del área

  Form states (por campo):
    inactive:   input sin borde de foco
    dirty:      botón "Save" activo (bg var(--ink), color var(--bg))
    submitting: botón "Saving…" deshabilitado + spinner 12px
    success:    mensaje "Saved." Geist Sans 12px, color hsl(140,40%,32%), 3s → desaparece
    error:      mensaje inline en destructive, accionable

  Botón Save por sección (no global):
    height: 32px, padding 0 16px, border-radius 8px
    bg var(--ink), color var(--bg), font-size 13px, font-weight 500
    Aparece solo cuando hay cambios (dirty state)
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
- [ ] Filas Desk/Workspace: título Geist, badge rounded-square, chips con icono y controles alineados
- [ ] Responsive wide/medium/narrow sin overflow de página ni controles ocultos

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
- [ ] Icono Sparkles visible en topbar right, entre AI y Properties
- [ ] Find & Replace bar anclada bajo topbar, empuja contenido (no overlay)
- [ ] Fila 1 (search): counter "N of M", flechas < >, toggle "Replace"
- [ ] Fila 2 (replace): solo visible con Replace activo, misma altura 40px
- [ ] Match activo: ámbar hsl(45,90%,60%) + outline hsl(35,80%,55%)
- [ ] Sin resultados: campo color destructive hsl(0,72%,51%)
- [ ] Escape cierra y devuelve foco al editor sin mover el cursor

### Panel Pulir

- [ ] Panel 280px, mismo patrón de apertura que AI Editor (cierra otros panels)
- [ ] Sección "REVISAR" con 4 toggles — todos activos por default
- [ ] Botón Analyze bg var(--ink), full width menos 32px, border-radius 8px
- [ ] Estado loading: label "Analizando…" + spinner + 3 skeletons animate-pulse
- [ ] Estado error: toast inline terracota-suave con "Try again"
- [ ] Resultados en 3 secciones expandibles con chevron y count badge
- [ ] Sugerencia ortográfica: tachado ink-4 → sugerido verde hsl(140,40%,32%)
- [ ] "Apply all" bg var(--ink) | "Re-analyze" border var(--border)
- [ ] Estado vacío: CheckCircle2 verde + "Looking good." en Geist Sans + Lora italic subtexto
