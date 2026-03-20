---
name: skill-design
description: Sistema de diseño visual de Odessay. Usa este skill siempre que vayas a construir cualquier componente de UI, configurar Tailwind, instalar o adaptar componentes de ShadCN, definir estilos tipográficos, o tomar cualquier decisión visual. También úsalo cuando implementes el editor, el espacio de lectura, el sidebar, las páginas públicas, o cualquier layout del proyecto. Si hay una decisión de color, fuente, espaciado, sombra, layout, componente o interacción involucrada, este skill aplica.
---

# Skill: Design System (Odessay)

Este skill define la lógica visual completa de Odessay. Todo lo que se construya visualmente parte de aquí. No se toman decisiones de diseño fuera de este documento — si algo no está definido, se pregunta antes de inventar.

Los archivos HTML en `/reference/` son prototipos interactivos que documentan el comportamiento validado. Sus screenshots están listados con descripción completa en `CLAUDE.md`. Los prototipos pueden tener diferencias menores respecto al diseño final — este documento y `vistas.md` (en esta misma carpeta) son la especificación oficial.

**Antes de implementar cualquier vista, leer `.agents/skills/skill-design/vistas.md`** — contiene valores exactos de padding, tamaños, colores y comportamiento por vista, más checklists de validación.

**Módulos compartidos — reutilizar, nunca recrear:** Sidebar y Topbar son componentes globales. No se implementan de nuevo por vista. El editor abre con sidebar mini (52px) por defecto. El resto de vistas abren con sidebar expandido (292px).

---

## Filosofía visual

Odessay es una plataforma de escritura epistolar. La interfaz no compite con el texto — la sirve. Cada decisión visual parte de esta premisa: el texto es el protagonista, la UI es el escenario.

Las superficies son cálidas, no clínicas. El fondo es casi blanco con temperatura cálida, como papel de calidad. La tipografía es el protagonista; la UI es el escenario.

El sistema tiene un focus mode donde la interfaz desaparece completamente — sidebar, toolbar, status bar — dejando solo el texto en pantalla.

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

**Lora** — todo lo epistolar: writings, lectura, títulos de cards, blockquotes. Serif con calidez literaria.

**Geist Sans** — todo lo funcional: navegación, labels, botones, badges, metadatos, inputs. Nunca en cuerpo de writing.

Nunca mezclar Lora y Geist Sans en el mismo elemento.

### Instalación

```bash
npm install geist
```

```tsx
// app/layout.tsx
import { GeistSans } from 'geist/font/sans'
import { Lora } from 'next/font/google'

const lora = Lora({
  subsets: ['latin'],
  variable: '--font-lora',
  style: ['normal', 'italic'],
  weight: ['400', '500'],
  display: 'swap',
})

export default function RootLayout({ children }) {
  return (
    <html className={`${GeistSans.variable} ${lora.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  )
}
```

```ts
// tailwind.config.ts
fontFamily: {
  sans:  ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
  lora:  ['var(--font-lora)', 'Georgia', 'serif'],
  serif: ['var(--font-lora)', 'Georgia', 'serif'], // alias
}
```

### Escala tipográfica validada

Escala proporcional 1.25x. Validada en prototipos HTML.

| Elemento | Tamaño | Weight | Fuente | Line-height |
|---|---|---|---|---|
| Logo "Odessay" | 17px | 400 | Lora | — |
| Writing title (editor) | 36px | 500 | Lora | 1.18 |
| H1 en writing | 30px | 500 | Lora | 1.2 |
| H2 en writing | 24px | 500 | Lora | 1.25 |
| H3 en writing | 20px | 500 | Lora | normal |
| Body de writing | 18px | 400 | Geist Sans | 1.85 |
| Blockquote | 22px | 400 italic | Lora | 1.7 |
| Card título (correspondence) | 22px | 500 | Lora | 1.2 |
| Card excerpt | 14px | 400 | Geist Sans | 1.65 |
| Reading title | 30px | 500 | Lora | 1.2 |
| Reading body | 17px | 400 | Geist Sans | 1.85 |
| Nav items sidebar | 15px | 400/500 | Geist Sans | — |
| Topbar título de vista | 15px | 400 | Lora | — |
| Botones, labels | 13–14px | 500 | Geist Sans | — |
| Badges, metadatos | 11–12px | 400 | Geist Sans | — |
| Labels uppercase | 10–11px | 600 | Geist Sans | letter-spacing: 0.07em |
| Status bar | 11px | 400 | Geist Sans | — |

**Regla:** Lora para lo epistolar (contenido que el usuario escribe y lee). Geist Sans para todo lo funcional (UI, labels, metadatos).

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

```ts
// tailwind.config.ts
borderRadius: {
  sm:   '6px',   // badges, botones pequeños
  md:   '8px',   // nav items, inputs, sub-panels
  lg:   '10px',  // cards principales, panels
  xl:   '12px',  // modales, banners
  pill: '13px',  // pills de estado
  full: '50%',   // avatares
}
```

Bordes siempre `0.5px solid` — nunca `1px`.

---

## Layout global

```
app (flex, 100vh, overflow hidden)
├── Sidebar (292px expandido / 52px mini)
└── Main (flex-1, flex-col)
    ├── Topbar (46px fijo)
    ├── Content (flex-1, overflow-y auto)
    └── [Statusbar opcional — solo en editor]
```

### Sidebar

**Expandido (292px):** Logo Lora 17px + toggle. Acciones (New writing, Search). Nav scroll. User bar bottom.

**Mini (52px):** Solo iconos centrados. Labels con `opacity-0 w-0 overflow-hidden`. Sub-items ocultos. Transición `width 300ms ease-layout`.

La caja se contrae hacia la derecha — los iconos no cambian de posición X.

### Topbar

Altura invariable: **46px** en todas las vistas. `border-bottom: 0.5px solid hsl(var(--border))`.

### Sidebar — dimensiones exactas

```ts
const SIDEBAR = {
  full: 292,  // px
  mini: 52,   // px
  rail: 52,   // icono rail siempre presente
  content: 240, // área de texto en expandido
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
| Hover en nav/cards | 180ms | ease |
| Popup entrance | 150ms | ease |

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
- Nunca mezclar Lora y Geist en el mismo elemento
- Nunca emojis en ninguna parte de la interfaz
- Nunca `transition: all`
- Siempre `strokeWidth={1.5}` en iconos Lucide
- `max-w-[660px] mx-auto` en áreas de **lectura** (reading view, espacio público)
- `max-w-[860px] mx-auto` en el **editor** (área de escritura)
- Siempre `font-sans` o `font-lora` explícito en componentes ShadCN
- Bordes siempre `0.5px` — nunca `1px` o `border` de Tailwind por defecto
