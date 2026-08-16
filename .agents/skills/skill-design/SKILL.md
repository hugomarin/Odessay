---
name: skill-design
description: Sistema de diseño visual de Odessay. Usa este skill siempre que vayas a construir cualquier componente de UI, configurar Tailwind, instalar o adaptar componentes de ShadCN, definir estilos tipográficos, o tomar cualquier decisión visual. También úsalo cuando implementes el editor, el espacio de lectura, el sidebar, las páginas públicas, o cualquier layout del proyecto. Si hay una decisión de color, fuente, espaciado, sombra, layout, componente o interacción involucrada, este skill aplica.
---

# Skill: Design System (Odessay)

Este skill define la lógica visual completa de Odessay. Todo lo que se construya visualmente parte de aquí. No se toman decisiones de diseño fuera de este documento — si algo no está definido, se pregunta antes de inventar.

**Límite con la capa de marketing.** Desde Fase 10 el producto tiene dos sistemas visuales que no se mezclan. Este skill gobierna la **capa de producto**: `app/(app)`, `app/(auth)`, `app/(reading)` y las superficies públicas de lectura de un documento. La **capa de marketing** —`app/(marketing)`, la home pública y cualquier superficie dirigida a alguien que todavía no es usuario— la gobierna `.agents/skills/skill-design-landing/SKILL.md`, con sus propios tokens bajo `[data-layer="marketing"]`. Comparten la marca, la familia de grises cálidos y Roboto Mono; nada más. Mezclarlas es el modo de fallo número uno del rediseño.

**Autoridad visual del rediseño.** Para cualquier vista de Fase 10, el prototipo `.dc.html` correspondiente en `docs/design/reference/` es la autoridad visual y este skill es la autoridad de implementación: el prototipo dice cuánto mide, el skill dice cómo se expresa (token en vez de hex, 0.5px en vez de 1px). Protocolo completo en `docs/design/migration-plan.md` §4.

Los archivos HTML en `/workflow/reference/` son prototipos interactivos que documentan el comportamiento validado. Sus screenshots están listados con descripción completa en `CLAUDE.md`. Los prototipos pueden tener diferencias menores respecto al diseño final — este documento, `vistas.md` y `tipografia.md` (en esta misma carpeta) son la especificación oficial.

**Antes de implementar cualquier vista, leer `.agents/skills/skill-design/vistas.md`** — contiene valores exactos de padding, tamaños, colores y comportamiento por vista, más checklists de validación.
**Si el issue toca presentación textual (write/preview/shared/public), leer también `.agents/skills/skill-design/tipografia.md`** — es el contrato tipográfico canónico cross-mode.

---

## Deltas resueltos (ODE-425) — respuesta única

Los cinco deltas entre el paquete de diseño y este skill están **cerrados**. Ninguna vista los vuelve a decidir. Si una fuente contradice esta tabla, esta tabla gana.

| # | Pregunta | Respuesta cerrada |
|---|---|---|
| 1 | ¿Cuál es el gris de hairline? | `hsl(var(--line-soft))` = `#EDEBE8` dentro de la hoja; `hsl(var(--line-softer))` = `#F0EEEB` entre filas de formulario. Nunca el hex literal. |
| 2 | ¿Qué fuente usa la UI? | **DM Sans**, en toda la UI. **Geist queda reservado exclusivamente al wordmark.** Lora sigue siendo la fuente del contenido epistolar. |
| 3 | ¿Cuánto mide el cuerpo del editor? | **17px / 1.9**, en `.odessay-editor-content` + `.prose-odessay`. Razón completa en `tipografia.md`. |
| 4 | ¿1px o 0.5px en bordes? | **0.5px**, siempre. El 1px de los prototipos `.dc.html` es un límite del entorno de prototipado, no una decisión de diseño. |
| 5 | ¿Writing o artifact? | **artifact** en toda UI nueva. Los nombres de archivo y símbolos migran en un pase mecánico posterior (ODE-439). |

**Nota de implementación del delta 2.** El token `--od-font-ui` es el que debe usarse. Desde ODE-446 la utilidad `font-sans` de Tailwind también resuelve a DM Sans (`--font-sans: var(--font-dm-sans)` en `globals.css`), así que ambos caminos coinciden y ya no queda mapeo legacy. `--font-geist-sans` sigue definido en `<html>` pero sin ningún consumidor: está reservado al wordmark. Ninguna vista puede apoyarse en `font-sans` para justificar Geist en UI.

---

**Módulos compartidos — reutilizar, nunca recrear:** Sidebar y Topbar son componentes globales. No se implementan de nuevo por vista. El editor abre con sidebar mini (52px) por defecto. El resto de vistas abren con sidebar expandido (244px).

---

## Filosofía visual

Odessay es una plataforma de escritura epistolar. La interfaz no compite con el texto — la sirve. Cada decisión visual parte de esta premisa: el texto es el protagonista, la UI es el escenario.

Las superficies son cálidas, no clínicas. El fondo es casi blanco con temperatura cálida, como papel de calidad. La tipografía es el protagonista; la UI es el escenario.

El sistema tiene un focus mode donde la interfaz desaparece completamente — sidebar, toolbar, status bar — dejando solo el texto en pantalla.

---

## Invariante de presentación textual (cross-mode)

El contenido de escritura/lectura puede vivir en shells distintos, pero su **presentación tipográfica y de overflow** debe ser equivalente en:

- `/write/[id]`
- `/preview/[token]`
- `/shared/[id]`
- `/{username}/{slug}`
- cualquier nueva superficie que renderice writings

Reglas:
- Definir un contrato común en una clase base compartida (ej. `odessay-rich-content`).
- No duplicar reglas incompatibles por vista para `table`, `pre/code`, links largos y wrapping de texto.
- Si una vista necesita un wrapper técnico distinto (ej. `tableWrapper`), debe mapear al mismo contrato visual que las otras superficies.
- Al cambiar reglas de presentación textual en una vista, actualizar simultáneamente las demás superficies del contrato.

---

## Tokens de color

Valores finales validados. Estos son los valores exactos — no aproximaciones.

En `globals.css` definir como CSS custom properties y como variables ShadCN simultáneamente — una sola fuente de verdad, sin duplicación:

```css
@layer base {
  :root {
    /* ── Odessay tokens ── */
    --bg:          38 12% 98%;    /* Fondo de página — casi blanco cálido */
    --sb:           0  0% 100%;   /* Sidebar y cards — blanco puro */
    --muted:       38  8% 93%;    /* Fondos inactivos, pills */
    --muted-h:     38  8% 90%;    /* Hover sobre elementos mutados */
    --border:      38  8% 90%;    /* Bordes y separadores */
    --ink:         25 18% 10%;    /* Texto principal */
    --ink-2:       25 12% 22%;    /* Texto nav y labels */
    --ink-3:       25 10% 38%;    /* Texto secundario / excerpts */
    --ink-4:       25  8% 52%;    /* Metadatos, placeholders */
    --cursor:      22 55% 38%;    /* Terracota — acento principal */

    /* ── ShadCN tokens — mapeados desde Odessay, sin duplicar ── */
    --background:         var(--bg);
    --foreground:         var(--ink);
    --card:               var(--sb);
    --card-foreground:    var(--ink);
    --popover:            var(--sb);
    --popover-foreground: var(--ink);
    --primary:            var(--ink);
    --primary-foreground: var(--bg);
    --secondary:          var(--muted);
    --secondary-foreground: var(--ink-2);
    --muted-foreground:   var(--ink-4);
    --accent:             var(--muted-h);
    --accent-foreground:  var(--ink-2);
    --destructive:        0 72% 51%;
    --destructive-foreground: var(--bg);
    --input:              var(--border);
    --ring:               var(--ink);
    --radius:             0.5rem;
  }
}
```

### Tokens del paquete Artifact Studio (delta 1 — cerrados)

Los prototipos usan cinco pasos neutros por debajo de `--ink-4`, dos hairlines dentro de la hoja y un verde de éxito. Todos tienen token; **ningún componente vuelve a escribir estos hex**. Los valores HSL están calculados para renderizar el hex del prototipo de forma exacta.

```css
:root {
  --ink-5:             30 9.8% 67.8%;    /* #B5ADA5 — placeholders, glifos disabled  */
  --ink-6:             34.3 12.7% 78.4%; /* #CFC9C1 — bordes dashed, tiles vacíos    */
  --line-soft:         36 12% 92%;       /* #EDEBE8 — hairline dentro de la hoja     */
  --line-softer:       36 14% 93%;       /* #F0EEEB — hairline entre filas de form   */
  --surface-selected:  34.3 41.2% 96.7%; /* #FAF7F3 — fila seleccionada / resumen    */
  --surface-row-hover: 30 25% 98.4%;     /* #FCFBFA — hover de fila de tabla         */
  --success:           145.1 46.2% 33.5%;/* #2E7D4F — done, restored, confirmaciones */
  --success-tint:      135 28.6% 91.8%;  /* #E4F0E7 — fondo de tile de éxito         */
}
```

Utilidades disponibles: `text-ink-5`, `text-ink-6`, `bg-line-soft`, `bg-line-softer`, `bg-surface-selected`, `bg-surface-row-hover`, `text-success`, `bg-success-tint`.

**Geometría de shell — valores, no utilidades.** Se leen desde `@theme` en vez de reescribir el número:

| Token | Valor | Qué es |
|---|---|---|
| `--size-rail-collapsed` | 52px | Rail colapsado |
| `--size-rail-expanded` | 244px | Rail expandido |
| `--size-settings-nav` | 244px | Nav de sección en Settings |
| `--size-panel-left` | 236px | Panel izquierdo (TOC, árbol de workspace) |
| `--size-panel-right` | 276px | Panel derecho (properties, notes) |
| `--size-titlebar` | 44px | Titlebar de desktop |
| `--size-topbar` | 48px | Topbar del editor |
| `--size-statusbar` | 46px | Status bar |
| `--size-sheet-editor` | 720px | Ancho de hoja del editor |
| `--size-sheet-reading` | 660px | Ancho de lectura |

**Sombras del paquete** — se suman a `shadow-float*`, no las reemplazan:

| Token | Uso |
|---|---|
| `--shadow-selection-bar` | Barra de selección flotante |
| `--shadow-modal` | Modales de flujo |
| `--shadow-auth-card` | Card de auth |
| `--shadow-splash-mark` | Marca del splash |

En Tailwind, extender con los nombres semánticos de Odessay:

```ts
// tailwind.config.ts
theme: {
  extend: {
    colors: {
      bg:       'hsl(var(--bg))',
      sb:       'hsl(var(--sb))',
      muted:    { DEFAULT: 'hsl(var(--muted))', hover: 'hsl(var(--muted-h))' },
      border:   'hsl(var(--border))',
      ink:      { DEFAULT: 'hsl(var(--ink))', 2: 'hsl(var(--ink-2))', 3: 'hsl(var(--ink-3))', 4: 'hsl(var(--ink-4))' },
      cursor:   'hsl(var(--cursor))',
    }
  }
}
```

---

## Tipografía

### Fuentes

**Lora** — todo lo epistolar: contenido del artifact, lectura, títulos de cards, blockquotes, títulos display de modales. Serif con calidez literaria.

**DM Sans** — todo lo funcional: navegación, filas, labels, botones, badges, metadatos, inputs, métricas. Es la fuente de **toda** la UI (delta 2). Token: `--od-font-ui`.

**Geist** — **solo el wordmark** (splash, nav de landing). No se usa en ninguna otra parte de la UI.

**Roboto Mono** — rutas de filesystem, counts en árboles, labels de diagrama.

Nunca mezclar Lora y DM Sans en el mismo elemento.

### Instalación

Las tres familias ya están cargadas en `app/layout.tsx`. DM Sans expone `--font-dm-sans` (consumida vía `--od-font-ui`), Lora expone `--font-lora`, Geist expone `--font-geist-sans` y **solo** alimenta el wordmark. Roboto Mono entra por `@font-face` en `globals.css`.

```tsx
// app/layout.tsx — estado vigente
import { GeistSans } from 'geist/font/sans'      // wordmark únicamente
import { DM_Sans, Lora } from 'next/font/google' // UI + contenido epistolar
```

```css
/* globals.css — los tokens que se usan en componentes */
--od-font-ui:    var(--font-dm-sans), system-ui, sans-serif;  /* toda la UI */
--od-font-meta:  var(--font-dm-sans), system-ui, sans-serif;  /* metadatos  */
--od-font-prose: var(--font-lora), Georgia, serif;            /* contenido  */
```

### Escala tipográfica validada

Valores del paquete Artifact Studio, verificados contra los prototipos `.dc.html`.

| Elemento | Tamaño | Weight | Fuente | Line-height |
|---|---|---|---|---|
| Wordmark "Artifact Studio" | 17px | 400 | Geist | — |
| Título de vista (Desk, Workspace, Settings) | 32px | 500 | DM Sans | 1–1.1, `-0.02em` |
| Subtítulo de vista | 14px | 400 | DM Sans | 1.5, ink-4 |
| Título de sección en hoja | 20–24px | 500 | DM Sans | 1.25 |
| Título de artifact (fila) | 15px | 500 | DM Sans | 1.3 |
| Título de artifact (preview / editor) | 28–32px | 500 | Lora | 1.2–1.25, `-0.015em` |
| Cuerpo del editor / lectura | **17px** | 400 | DM Sans | **1.9** |
| H2 dentro del editor | 17px | 600 | DM Sans | 1.5 |
| H1 en contenido | 30px | 500 | Lora | 1.2 |
| H2 en contenido | 24px | 500 | Lora | 1.25 |
| H3 en contenido | 20px | 500 | Lora | normal |
| Blockquote | 22px | 400 italic | Lora | 1.7 |
| Meta de fila, counts | 12px | 400 | DM Sans | — |
| Nav items sidebar | 15px | 400/500 | DM Sans | — |
| Controles, botones, labels | 13–14px | 500 | DM Sans | — |
| Overline | 10–11px | 600 | DM Sans | `.09–.13em`, uppercase, ink-4 |
| Status bar | 11px | 400 | DM Sans | — |
| Path, count de árbol | 11–13px | 400 | Roboto Mono | — |

**Regla:** Lora para lo epistolar (contenido que el usuario escribe y lee). DM Sans para todo lo funcional (UI, labels, metadatos). Roboto Mono solo para rutas y counts. Geist solo para el wordmark.

---

## Sombras

Difusas, cálidas, nunca duras.

```ts
// tailwind.config.ts
boxShadow: {
  'float':    '0 2px 12px 0 hsla(25,18%,12%,0.06), 0 1px 3px 0 hsla(25,18%,12%,0.04)',
  'float-md': '0 4px 24px 0 hsla(25,18%,12%,0.08), 0 2px 6px 0 hsla(25,18%,12%,0.04)',
  'float-lg': '0 8px 32px 0 hsla(25,18%,12%,0.10), 0 2px 8px 0 hsla(25,18%,12%,0.06)',
}
```

| Uso | Sombra |
|---|---|
| Cards en /desk, mini-docs | `shadow-float` |
| Panels, popovers | `shadow-float-md` |
| Modales, menú de usuario | `shadow-float-lg` |

---

## Border radius

Escala cerrada: **6 · 7–8 · 9 · 10 · 13–14 · 18 · 50%**. No se inventan pasos intermedios.

| Paso | Uso | Token |
|---|---|---|
| 6px | badges, botones pequeños | `rounded-sm` |
| 7–8px | icon buttons | `rounded-md` |
| 9px | inputs, nav items | `rounded-[9px]` — sin token todavía |
| 10px | cards, panels | `rounded-lg` |
| 12px | banners | `rounded-xl` |
| 13px | pills de estado | `rounded-pill` |
| 14px | barra de selección flotante | `rounded-bar` |
| 18px | modales | `rounded-modal` |
| 50% | avatares | `rounded-full` |

**Bordes (delta 4):** siempre `0.5px solid` — nunca `1px`. Los prototipos `.dc.html` dibujan 1px porque su entorno no expresa medios píxeles; eso es un límite de la herramienta, no una decisión de diseño, y no se copia al repo.

---

## Espaciado

Escala cerrada de **4px**: `4 · 8 · 12 · 14 · 16 · 20 · 24 · 32 · 40 · 48`. Todo padding, gap y margin de UI cae en un múltiplo de 4. Los valores fuera de la escala son un error de transcripción del prototipo, no una excepción.

---

## Scrollbars

Toda región con scroll usa la clase `.od-scroll` — definida una sola vez en `globals.css`. Ningún componente redefine su propia scrollbar.

```
ancho:  10px
thumb:  #E3E0DB, borde transparente de 3px, background-clip: content-box, radius 10px
track:  transparent
firefox: scrollbar-width: thin
```

---

## Vocabulario (delta 5)

El término de producto es **artifact**. En toda UI nueva: "New artifact", "Search artifacts…", "3 artifacts". No "writing", no "document", no "post".

El repo todavía nombra `writing` en archivos y símbolos (`writing-preview-modal.tsx`, `WritingContentFrame`, "Search writings…"). Eso es deuda declarada: **primero migra la copy visible, los nombres de archivo y símbolos van en un pase mecánico posterior** (ODE-439). Un componente nuevo no hereda el nombre viejo.

---

## Layout global

```
app (flex, 100vh, overflow hidden)
├── Sidebar (244px expandido / 52px mini)
└── Main (flex-1, flex-col)
    ├── Topbar (46px fijo)
    ├── Content (flex-1, overflow-y auto)
    └── [Statusbar opcional — solo en editor]
```

### Sidebar

**Expandido (244px):** Logo Lora 17px + toggle. Acciones (New writing, Search). Nav scroll. User bar bottom.

**Mini (52px):** Solo iconos centrados. Labels con `opacity-0 w-0 overflow-hidden`. Sub-items ocultos. Transición `width 300ms ease-layout`.

La caja se contrae hacia la derecha — los iconos no cambian de posición X.

### Topbar

Altura invariable: **46px** en todas las vistas. `border-bottom: 0.5px solid hsl(var(--border))`.

### Sidebar — dimensiones exactas

```ts
const SIDEBAR = {
  full: 244,  // px — docs/design/system-app.md §3 [ODE-447]
  mini: 52,   // px
  rail: 52,   // icono rail siempre presente
  content: 192, // área de texto en expandido (244 - 6 padding x2 - 10 padding x2 - 19 icono - 9 gap)
}
```

---

## Iconografía

**Librería:** Lucide React. Incluida con ShadCN.

**Siempre** `strokeWidth={1.5}` — sin excepción.

```tsx
// ✓ Correcto
<FileStack strokeWidth={1.5} className="h-[14px] w-[14px]" />

// ✗ Incorrecto
<FileStack className="h-4 w-4" />
```

| Contexto | Tamaño |
|---|---|
| Nav sidebar | 14×14px |
| Toolbar editor | 13×13px |
| Metadatos, badges | 12×12px |
| Sub-items sidebar | 12×12px |
| Topbar tools | 14×14px |

### Mapa de iconos de Odessay

| Sección | Icono Lucide |
|---|---|
| Desk | `LayoutGrid` |
| Collections | `BookMarked` |
| Correspondences | `FileStack` |
| Shared | `Share2` |
| Search | `Search` |
| Recent writings | `PenLine` |
| Notes panel | `AlignLeft` |
| AI editor | `Feather` |
| Properties | `SlidersHorizontal` |
| Focus mode | `Maximize2` |
| New writing | `Plus` |
| Import | `Upload` |

---

## Componentes ShadCN

Inicializar: `npx shadcn@latest init` — Style: Default, Base color: Neutral, CSS variables: Yes.

### Estrategia de adaptación — tres capas, en orden

La personalización de ShadCN ocurre en tres capas. Cada una tiene un propósito distinto. Nunca saltarse una capa para hacer algo en la siguiente — eso produce estilos huérfanos.

**Capa 1 — `globals.css` (tokens):** La mayor parte del trabajo. Los tokens de Odessay ya están mapeados a las variables que ShadCN espera (`--primary`, `--border`, `--muted`, etc.). La mayoría de los componentes quedan visualmente correctos con solo esta capa — sin tocar nada más.

**Capa 2 — archivo del componente (`/components/ui/`):** Al instalar un componente con `npx shadcn@latest add`, se edita su archivo *una sola vez* para fijar los defaults de Odessay: la clase de sombra, el font-family, el border-radius. A partir de ese momento, cada uso del componente hereda el default correcto sin necesidad de `className` adicional.

```tsx
// Ejemplo: /components/ui/card.tsx — editar una vez al instalar
// Cambiar el className default de Card:
// De: "rounded-xl border bg-card text-card-foreground shadow"
// A:  "rounded-[10px] border-[0.5px] bg-sb shadow-float font-sans"
// Todos los <Card> del proyecto usan esto automáticamente.
```

**Capa 3 — `className` en el punto de uso:** Solo para variaciones de contexto que no son defaults — ancho de un panel específico, tamaño de un avatar en una vista concreta, variante terracota de un botón. Si se encuentra la misma combinación de clases en más de dos lugares, subir a Capa 2.

```tsx
// ✓ Correcto — variación de contexto
<Card className="w-[220px]">  {/* ancho específico del hero card */}

// ✗ Incorrecto — default que debería estar en Capa 2
<Card className="rounded-[10px] border-[0.5px] bg-sb shadow-float">
```

**Señal de alarma:** Si un agente agrega más de 3 clases a un componente ShadCN en el punto de uso, probablemente hay un default que debería estar en Capa 2.

---

### Configuración base por componente (Capa 2)

Estos son los cambios a hacer en cada archivo de componente al instalarlo. Se hacen una vez.

| Componente | Cambios en `/components/ui/` |
|---|---|
| `card.tsx` | `rounded-[10px] border-[0.5px] bg-sb shadow-float` |
| `button.tsx` | `font-sans` en la clase base; `rounded-[8px]` |
| `input.tsx` | `font-sans border-[0.5px]` |
| `textarea.tsx` | `font-sans border-[0.5px]` |
| `dialog.tsx` | `shadow-float-lg border-[0.5px] font-sans` |
| `popover.tsx` | `shadow-float-md border-[0.5px]` |
| `dropdown-menu.tsx` | `shadow-float-md border-[0.5px]` |
| `tooltip.tsx` | `font-sans text-xs shadow-float` |
| `badge.tsx` | `font-sans rounded-[6px] border-[0.5px]` |
| `sheet.tsx` | `shadow-float-lg border-[0.5px]` |
| `avatar.tsx` | `rounded-full` (ya es default) |

### Variantes permitidas en el punto de uso (Capa 3)

Solo estas variaciones se agregan en `className` en el punto de uso. No inventar nuevas sin actualizar este documento.

**Button:**
```tsx
// Acción estándar (hereda default tinta oscura de Capa 1/2)
<Button>Confirm</Button>

// Acción fundacional — terracota
<Button className="bg-cursor text-white hover:opacity-90">Write a response</Button>

// Ghost — nav items, acciones secundarias
<Button variant="ghost" className="justify-start w-full">...</Button>
```

**Input en título del editor:**
```tsx
// Único caso donde Input pierde su estructura visible
<Input className="border-none bg-transparent shadow-none font-lora text-4xl" />
```

**Card con ancho fijo:**
```tsx
<Card className="w-[220px]">  {/* Hero draft card */}
<Card className="max-w-[560px]">  {/* Mini-doc de correspondencia */}
```

**Badge — dos variantes, nada más:**
```tsx
<Badge className="bg-muted text-ink-4">Draft</Badge>
<Badge className="bg-ink text-bg">Done</Badge>
```

**Avatar — dos tamaños:**
```tsx
<Avatar className="h-7 w-7">     {/* Sidebar, participantes */}
<Avatar className="h-[44px] w-[44px]">  {/* Mini-docs de correspondencia */}
```

**Sheet — ancho por panel:**
```tsx
<Sheet className="w-[248px]">  {/* Properties, Notes */}
<Sheet className="w-[280px]">  {/* AI Editor */}
```

---

## Transiciones

```css
/* En globals.css */
:root {
  --ease-layout: cubic-bezier(0.4, 0, 0.15, 1);
}
```

| Tipo | Duración | Easing |
|---|---|---|
| Sidebar collapse/expand | 300ms | ease-layout |
| Panel derecho open/close | 300ms | ease-layout |
| Sub-items expand | 320ms | ease-layout |
| Chevron rotation | 280ms | ease-layout |
| Labels fade (sidebar mini) | 250ms | ease |
| Focus mode | 350ms | ease-layout |
| Hover en nav/cards | 140–180ms | ease |
| Popup entrance | 150ms | ease |

Curvas del paquete Artifact Studio, cerradas (delta 1 · `docs/design/system-app.md` §6). Sus keyframes viven en `globals.css`; ningún overlay los redefine:

| Transición | Duración / easing | Keyframe |
|---|---|---|
| Rail collapse/expand, panels | 300ms `cubic-bezier(.4,0,.15,1)` | — |
| Modal in | 260ms | `odModalIn` |
| Step in | 220ms | `odStepIn` |
| Splash mark in | 420ms | `odMarkIn` |
| Crawl (barra de progreso indeterminada) | — | `odCrawl` |
| Focus mode | 350ms | — |

```css
/* Keyframes en globals.css */
@keyframes menuIn {
  from { opacity: 0; transform: translateY(6px) scale(0.99); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

**Reglas:** Nunca `transition: all`. Siempre propiedad específica. Nunca easing lineal en UI.

---

## Convención de botones

Dos colores primarios con semántica distinta:

**Tinta oscura `bg-ink text-bg`** — acciones funcionales cotidianas: confirmar, guardar, insertar.

**Terracota `bg-cursor text-white`** — acciones fundacionales: iniciar correspondencia, publicar por primera vez, invitar a responder, escribir una respuesta. No usar para acciones frecuentes — diluye el peso semántico.

Nunca dos botones del mismo color en el mismo modal.

---

## Reglas invariables

- Nunca `#ffffff` o `white` como fondo de página — siempre `bg-bg`
- Nunca sombras de Tailwind por defecto — siempre `shadow-float*`
- Nunca mezclar Lora y DM Sans en el mismo elemento
- Nunca Geist fuera del wordmark
- Nunca hardcodear un hex que ya tiene token (`#EDEBE8`, `#B5ADA5`, `#FAF7F3`, `#2E7D4F`, …)
- Nunca una scrollbar propia — siempre `.od-scroll`
- Nunca "writing" en UI nueva — el término es **artifact**
- Nunca emojis en ninguna parte de la interfaz
- Nunca `transition: all`
- Siempre `strokeWidth={1.5}` en iconos Lucide
- `max-w-[660px] mx-auto` en áreas de **lectura** (reading view, espacio público)
- `max-w-[860px] mx-auto` en el **editor** (área de escritura)
- Siempre `font-sans` o `font-lora` explícito en componentes ShadCN
- Bordes siempre `0.5px` — nunca `1px` o `border` de Tailwind por defecto
