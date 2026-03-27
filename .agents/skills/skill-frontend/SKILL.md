---
name: skill-frontend
description: Arquitectura y estándares de implementación frontend de Odessay (Next.js 15, React, TypeScript). Usa este skill para cualquier decisión de arquitectura de componentes, estructura de archivos, naming conventions, TipTap, Server/Client components, accesibilidad, responsive, y checklist de entrega. Para tokens de color, tipografía, sombras, y guía de ShadCN, consulta skill-design.md primero.
---

# Skill: Frontend (Odessay)

Lee `skill-design.md` antes de implementar cualquier componente con UI.

Lee `.agents/skills/skill-design/vistas.md` antes de implementar cualquier vista. Contiene los valores exactos de padding, tipografía, colores y comportamiento de cada componente en cada vista (Desk, Collections, Correspondences, Reading, Editor), más el checklist de validación para verificar que tu implementación coincide con la referencia visual.

---

## Principio rector

Odessay es un santuario. Cada píxel comunica sacralidad. Antes de agregar cualquier elemento visual: ¿esto es necesario o es ruido?

Y antes de cualquier decisión técnica, una segunda pregunta:

> ¿Esto hace que la app se sienta más rápida e inmediata, o la vuelve más pesada y frágil?

Escribir debe sentirse instantáneo. Abrir un documento debe ser casi inmediato. Guardar no debe interrumpir. Estas no son metas de performance — son la experiencia base del producto.

---

## Stack

```
Next.js 15 (App Router)
React 19
TypeScript — strict mode, sin `any`
Tailwind CSS — única herramienta de styling
ShadCN/UI — componentes accesibles, personalizados solo en colores, tipografía, bordes y sombras vía tokens CSS
TipTap — editor headless
TanStack Query — server data, cache y loading states
Zustand — sync state y AI state (solo estos dos slices)
Lucide React — iconografía (strokeWidth={1.5} siempre)
Geist Sans + Lora — tipografía (ver skill-design.md)
```

---

## Velocidad e inmediatez — reglas no negociables

Estas reglas no son optimizaciones opcionales. Son criterios de corrección del producto.

### El editor es una isla

El editor TipTap debe estar aislado del resto del árbol de React. Ningún keystroke debe provocar re-renders en el sidebar, paneles de AI, historial, settings, o cualquier otra capa de la UI.

```tsx
// ✓ Correcto — editor aislado, estado separado
// El editor maneja su propio estado interno.
// Solo comunica hacia afuera a través de callbacks debounced.
<EditorIsland onSave={debouncedSave} onWordCount={updateCount} />

// ✗ Incorrecto — editor conectado al store global
// Cada tecla dispara un update en el store que re-renderiza todo
const { content, setContent } = useWritingStore()
<Editor value={content} onChange={setContent} />
```

### Estado segmentado — cuatro dominios, cuatro herramientas

Nunca un store global monolítico. Cada dominio tiene su herramienta y no se mezclan.

```
Dominio          Herramienta         Razón
──────────────────────────────────────────────────────────────────
Document state   TipTap interno      Un keystroke no sale del editor
UI state         useState local      Efímero, no necesita store global
Server data      TanStack Query      Cache, revalidación, loading automático
Sync state       Zustand (slice)     Compartido entre editor y statusbar
AI state         Zustand (slice)     Compartido entre editor y panel AI
```

**Document state — TipTap únicamente**
El JSON del documento y el conteo de palabras viven dentro de TipTap. Nunca se sincronizan a un store externo en tiempo real. El editor comunica hacia afuera solo a través de callbacks debounced.

```ts
// Solo esto sale del editor hacia afuera — y solo con debounce
type EditorOutput = { body_json: JSONContent; body_text: string; word_count: number }
```

**UI state — `useState` local**
Sidebar expandido/mini, panel activo, filtro seleccionado, modal abierto. Estado de componente, no store. Si un estado de UI necesita cruzar más de dos niveles de componentes, se revisa la arquitectura antes de mover a Zustand.

**Server data — TanStack Query**
Writings, correspondencias, collections, margins — todo lo que viene de Supabase o de la base local. TanStack Query maneja cache, loading, error y revalidación. No hay `useEffect` para fetching.

```ts
// ✓ Correcto
const { data: writings, isLoading } = useQuery({
  queryKey: ['writings', { status: 'draft' }],
  queryFn: () => localDB.getWritings({ status: 'draft' }),
})

// ✗ Incorrecto
const [writings, setWritings] = useState([])
useEffect(() => { fetchWritings().then(setWritings) }, [])
```

**Sync state y AI state — Zustand, dos slices separados**
Son los únicos estados que se comparten entre componentes sin relación directa (editor ↔ statusbar para sync, editor ↔ panel AI para observaciones).

```ts
// store/sync.ts
type SyncState = {
  status: 'saved' | 'saving' | 'pending' | 'error'
  lastSavedAt: Date | null
  setSaving: () => void
  setSaved: () => void
  setError: () => void
}

// store/ai.ts
type AIState = {
  observations: Observation[]
  loading: boolean
  addObservation: (obs: Observation) => void
  dismissObservation: (id: string) => void
}
```

Zustand no se usa para nada más. Si aparece la tentación de agregar un tercer slice, revisar si TanStack Query o useState local resuelven el problema.

### Carga diferida — solo lo esencial en la primera carga

La primera carga incluye únicamente: el documento actual, el editor TipTap, la barra mínima de acciones, y el mecanismo de auto-save local. Todo lo demás entra por lazy load cuando se necesita:

```tsx
// ✓ Lazy load para paneles secundarios
const EditorPanelAI = lazy(() => import('./EditorPanelAI'))
const EditorPanelProperties = lazy(() => import('./EditorPanelProperties'))
const CollectionsOrganizePanel = lazy(() => import('./CollectionsOrganizePanel'))
```

### Perceived performance — métricas que importan

No optimizar solo para benchmarks. Optimizar para lo que el usuario siente:

| Métrica | Objetivo |
|---|---|
| Tiempo hasta editable | < 1 segundo |
| Latencia de keystroke | < 16ms (60fps) |
| Auto-save (local) | Invisible — nunca bloquea |
| Apertura de panel secundario | < 200ms |
| Respuesta de AI visible | Streaming, primeros tokens < 800ms |

Medir desde el inicio. No al final.

```tsx
// Medir tiempo hasta editable en desarrollo
if (process.env.NODE_ENV === 'development') {
  performance.mark('editor-mount-start')
  // ... en el editor, cuando está listo:
  performance.mark('editor-ready')
  performance.measure('time-to-editable', 'editor-mount-start', 'editor-ready')
}
```

### Protocolo operativo de performance (critical path)

Aplica siempre que el issue toque interacción de escritura o lectura activa:
- editor TipTap (`keydown`, `input`, `paste`);
- acciones de selección/click dentro del documento;
- paneles que se abren durante escritura;
- auto-save, sync, o observaciones AI que compiten por main thread.

Si el issue toca alguno de estos puntos, no se implementa "a ciegas". Se mide before/after.

1. Capturar baseline del issue (before):

```bash
npm run ops:perf:capture -- --output artifacts/perf/editor-before.json.gz
npm run ops:perf:gate -- --trace artifacts/perf/editor-before.json.gz --report artifacts/perf/editor-before-report.json --metrics artifacts/perf/editor-before-metrics.json
```

2. Implementar el cambio.
3. Capturar trace final (after):

```bash
npm run ops:perf:capture -- --output artifacts/perf/editor-after.json.gz
npm run ops:perf:gate -- --trace artifacts/perf/editor-after.json.gz --report artifacts/perf/editor-after-report.json --metrics artifacts/perf/editor-after-metrics.json
```

4. Evaluar diff before/after contra `workflow/perf-budgets.json`.
5. Si `required_failures > 0`, el cambio no está listo para PR.

### Anti-patterns de performance (bloqueantes)

- Publicar updates de editor en Zustand o contexto global por keystroke.
- Disparar fetch/sync remoto en cada `onUpdate` sin debounce.
- Mount de paneles secundarios en primera carga sin lazy loading.
- Parseos o transformaciones pesadas en el hilo principal dentro de handlers de input.
- Cálculos de word count/derivados fuera de TipTap en cada tecla.
- Ejecutar lógica AI síncrona en el camino de interacción del editor.
- Introducir dependencias de UI pesadas sin presupuesto de impacto medido.

---

## Nomenclatura semántica de componentes

### Regla general

Cada módulo de UI se envuelve en un `<section>` con `id` y `data-page`. Cada sub-bloque usa `id`, `data-section`, `data-testid`, y una clase BEM en PascalCase. Esto permite identificar componentes en el DOM, en tests, y en herramientas de desarrollo sin ambigüedad.

```tsx
<section id="module-root" data-page="module-root">
  <div
    id="module-part-a"
    data-section="module-part-a"
    data-testid="module-part-a"
    className="ModulePartA"
  >
    {/* contenido */}
  </div>
</section>
```

### Mapa de IDs por vista

**Sidebar (global):**

```tsx
<nav id="sidebar" data-page="sidebar">
  <div id="sidebar-top"         data-section="sidebar-top"         data-testid="sidebar-top"         className="SidebarTop" />
  <div id="sidebar-actions"     data-section="sidebar-actions"     data-testid="sidebar-actions"     className="SidebarActions" />
  <div id="sidebar-nav"         data-section="sidebar-nav"         data-testid="sidebar-nav"         className="SidebarNav" />
  <div id="sidebar-bottom"      data-section="sidebar-bottom"      data-testid="sidebar-bottom"      className="SidebarBottom" />
</nav>
```

**Desk (`/desk`):**

```tsx
<section id="desk" data-page="desk">
  <div id="desk-topbar"         data-section="desk-topbar"         data-testid="desk-topbar"         className="DeskTopbar" />
  <div id="desk-hero"           data-section="desk-hero"           data-testid="desk-hero"           className="DeskHero" />
  <div id="desk-filter-bar"     data-section="desk-filter-bar"     data-testid="desk-filter-bar"     className="DeskFilterBar" />
  <div id="desk-activity-table" data-section="desk-activity-table" data-testid="desk-activity-table" className="DeskActivityTable" />
</section>
```

**Collections (`/collections`):**

```tsx
<section id="collections" data-page="collections">
  <div id="collections-topbar"        data-section="collections-topbar"        className="CollectionsTopbar" />
  <div id="collections-uncategorized" data-section="collections-uncategorized" className="CollectionsUncategorized" />
  <div id="collections-organize"      data-section="collections-organize"      className="CollectionsOrganize" />
  <div id="collections-list"          data-section="collections-list"          className="CollectionsList" />
</section>
```

**Correspondence hilo (`/correspondences/:id`):**

```tsx
<section id="correspondence-thread" data-page="correspondence-thread">
  <div id="correspondence-topbar"        data-section="correspondence-topbar"        className="CorrespondenceTopbar" />
  <div id="correspondence-participants"  data-section="correspondence-participants"  className="CorrespondenceParticipants" />
  <div id="correspondence-sequence"      data-section="correspondence-sequence"      className="CorrespondenceSequence" />
  <div id="correspondence-reply-prompt"  data-section="correspondence-reply-prompt"  className="CorrespondenceReplyPrompt" />
</section>
```

**Reading view:**

```tsx
<section id="reading-view" data-page="reading-view">
  <div id="reading-chrome"       data-section="reading-chrome"       className="ReadingChrome" />
  <div id="reading-text"         data-section="reading-text"         className="ReadingText" />
  <div id="reading-margin-panel" data-section="reading-margin-panel" className="ReadingMarginPanel" />
  <div id="selection-popup"      data-section="selection-popup"      className="SelectionPopup" />
  <div id="annotation-bubble"    data-section="annotation-bubble"    className="AnnotationBubble" />
</section>
```

**Editor (`/write/:id`):**

```tsx
<section id="editor" data-page="editor">
  <div id="editor-topbar"            data-section="editor-topbar"            className="EditorTopbar" />
  <div id="editor-writing-area"      data-section="editor-writing-area"      className="EditorWritingArea" />
  <div id="editor-statusbar"         data-section="editor-statusbar"         className="EditorStatusbar" />
  <div id="editor-panel-notes"       data-section="editor-panel-notes"       className="EditorPanelNotes" />
  <div id="editor-panel-ai"          data-section="editor-panel-ai"          className="EditorPanelAI" />
  <div id="editor-panel-properties"  data-section="editor-panel-properties"  className="EditorPanelProperties" />
</section>
```

### Naming convention

Las clases BEM son para identificación semántica, no para styling. El styling va en Tailwind.

```tsx
// ✓ Correcto
<div
  id="desk-hero-draft-card"
  data-section="desk-hero-draft-card"
  data-testid="desk-hero-draft-card"
  className="DeskHeroDraftCard flex flex-col gap-2 p-4 rounded-lg bg-sb border border-[0.5px]"
>

// ✗ Incorrecto — BEM como estilo
<div className="desk-hero__draft-card--active">
```

---

## Arquitectura de componentes

### Server vs Client

Server Components por defecto. `"use client"` solo cuando necesites: estado (`useState`, `useReducer`), efectos (`useEffect`), eventos del browser, TipTap (siempre client), o Refs del DOM.

```tsx
// ✓ Server — datos, layout, estructura
export default async function DeskPage() {
  const writings = await getDraftWritings()
  return <DeskHero writings={writings} />
}

// ✓ Client — interacción
"use client"
export function DeskFilterBar() {
  const [active, setActive] = useState('all')
}
```

### Estructura de archivos

```
app/
  (auth)/
    desk/page.tsx
    collections/page.tsx
    collections/[id]/page.tsx
    correspondences/[id]/page.tsx
    write/[id]/page.tsx
  layout.tsx

components/
  sidebar/
    Sidebar.tsx
    SidebarNav.tsx
    SidebarNavItem.tsx
    SidebarBottom.tsx
  desk/
    DeskTopbar.tsx
    DeskHero.tsx
    DeskHeroDraftCard.tsx
    DeskFilterBar.tsx
    DeskActivityTable.tsx
    DeskActivityRow.tsx
  collections/
    CollectionsTopbar.tsx
    CollectionsUncategorized.tsx
    CollectionsOrganizePanel.tsx
    CollectionsList.tsx
    CollectionBlock.tsx
    CollectionWritingItem.tsx
  correspondence/
    CorrespondenceTopbar.tsx
    CorrespondenceParticipants.tsx
    CorrespondenceSequence.tsx
    CorrespondenceMiniDoc.tsx
    CorrespondenceReplyPrompt.tsx
  reading/
    ReadingChrome.tsx
    ReadingText.tsx
    ReadingMarginPanel.tsx
    SelectionPopup.tsx
    AnnotationBubble.tsx
    MarginEntry.tsx
  editor/
    Editor.tsx              ← "use client" — TipTap, siempre aislado
    EditorTopbar.tsx
    EditorStatusbar.tsx
    EditorPanelNotes.tsx
    EditorPanelAI.tsx
    EditorPanelProperties.tsx
  ui/                       ← ShadCN (no tocar)
```

### Reglas de componentes

- Un componente por archivo. PascalCase coincide con clase BEM.
- Props tipadas con TypeScript interfaces. Sin `any`.
- Si supera ~120 líneas, descomponer.
- Componentes de lista siempre reciben `items` como prop, nunca fetches internos.

---

## Editor TipTap

Siempre `"use client"`. Siempre aislado. El output es ProseMirror JSON (`body_json`) + texto plano (`body_text`). Markdown es un formato de I/O, nunca el modelo persistido — ver `odessay-editor.md` (sección: Modelo de edición).

El editor tiene dos modos de UI: **Rich** (edición visual, por defecto) y **Source** (Markdown crudo, para usuarios que lo prefieren). El toggle está en la topbar. Al cambiar de Source → Rich, el Markdown se re-parsea a JSON vía `tiptap-markdown`. No hay pérdida en ninguna dirección dentro del subconjunto soportado.

```tsx
"use client"
const editor = useEditor({
  extensions: [
    Document, Paragraph, Text,
    Heading.configure({ levels: [1, 2, 3] }),
    Bold, Italic, Link,
    Blockquote, BulletList, OrderedList, ListItem,
    Code, CodeBlock,
    Markdown,   // tiptap-markdown — serialización y parseo JSON ↔ Markdown
    History,
    Placeholder.configure({ placeholder: 'Escribe algo...' }),
    CharacterCount,
    // Custom: FootnoteExtension, AIObservationExtension
  ],
  onUpdate: ({ editor }) => {
    // 1. Guarda local primero — inmediato, sin debounce
    saveToLocal({ body_json: editor.getJSON(), body_text: editor.getText() })
    // 2. Encola sync remoto — background, debounce 1500ms
    debouncedSyncRemote(1500)
  }
})
```

Auto-save local: inmediato. Sync remoto: debounce 1500ms. Sin indicador agresivo — solo estado sutil en statusbar.

**Extensiones excluidas intencionalmente:** `Underline` (Markdown no lo soporta), `Strike` (fuera del subconjunto epistolar). No agregar sin revisar `odessay-editor.md`.

Shortcuts: `⌘B`, `⌘I`, `⌘K`, `⌘⌥1/2/3`, `⌘⇧F`. Sin toolbar flotante al seleccionar.

---

## Estados transversales de UI

Estos tres estados aparecen en todas las vistas. Se implementan de la misma forma en todas partes — sin inventar variaciones por vista.

### Carga — Skeletons

Nunca spinners. Los skeletons replican la estructura del contenido que van a mostrar, con las mismas dimensiones y espaciado. El usuario no ve un estado genérico — ve la forma exacta de lo que está cargando.

```tsx
// ✓ Correcto — skeleton que replica la estructura real
function DeskHeroSkeleton() {
  return (
    <div className="flex gap-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="w-[220px] h-[140px] rounded-[10px] bg-muted animate-pulse" />
      ))}
    </div>
  )
}

// ✗ Incorrecto — spinner genérico
<div className="flex justify-center"><Spinner /></div>
```

Reglas de skeleton:
- `bg-muted animate-pulse` siempre — sin variaciones de color
- `border-radius` igual al componente final
- Mismas dimensiones que el componente real (width, height, gap)
- No texto, no iconos — solo forma

TanStack Query expone `isLoading` para el primer fetch y `isFetching` para refetch. Los skeletons se muestran solo en `isLoading` — los refetch son silenciosos.

### Vacío — Empty states

Cada vista con contenido listable tiene un empty state. La estructura es siempre la misma: descripción breve de la sección + botón de primera acción cuando aplica.

```tsx
function EmptyState({ description, action }: { description: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="font-lora italic text-[15px] text-ink-3 max-w-[280px] leading-relaxed">
        {description}
      </p>
      {action && (
        <Button onClick={action.onClick}>{action.label}</Button>
      )}
    </div>
  )
}
```

Texto en Lora italic, `ink-3`. Tono calmo, epistolar — no cheerful ni startup. El botón usa el default (tinta oscura), nunca terracota para una primera acción vacía.

Mensajes por vista:

| Vista | Descripción | Botón |
|---|---|---|
| `/desk` sin writings | "Your writings will appear here." | "Start writing" |
| `/desk` tabla sin actividad | "No recent activity." | — |
| `/collections` sin collections | "Organize your writings into collections." | "New collection" |
| `/correspondences` sin hilos | "Your correspondences will appear here." | — |
| `/shared` sin compartidos | "Nothing has been shared with you yet." | — |
| Collection vacía | "This collection has no writings yet." | "Add writings" |

### Errores — Toast

Los errores que el usuario necesita saber se muestran como toast. Los errores que no lo requieren (sync en background, errores de AI) son silenciosos — se loggean server-side y no interrumpen.

```tsx
// Usar el componente Toast de ShadCN con hook useToast
const { toast } = useToast()

// Llamar cuando hay un error que el usuario debe saber
toast({
  description: "Couldn't save your writing. We'll keep trying.",
  duration: 4000,
})
```

Reglas de toast:
- Posición: bottom-center
- Duración: 4 segundos, sin "dismiss" manual
- Sin título, solo `description`
- Sin iconos
- El estilo viene del token system vía ShadCN — fondo `--ink`, texto `--bg` (configurado en Capa 2 de `toast.tsx`)
- Mensaje en inglés, tono humano, primera persona plural ("We couldn't...")
- Nunca mostrar mensajes técnicos (`error.message` del servidor va al log, no al usuario)

Errores que **sí** muestran toast: fallo al compartir, fallo al crear collection, fallo al cargar una correspondencia, fallo de autenticación inesperado.

Errores que **no** muestran toast: fallo de sync remoto (el statusbar lo refleja sutilmente), silencio del AI editor, fallo de refetch en background.

### Validación de formularios

Aplica a `/login`, `/signup`, `/settings` y cualquier formulario futuro. Patrón único — sin variaciones por vista.

**Cuándo validar:**
- `onBlur` — la validación se dispara al salir del campo. No se interrumpe al usuario mientras escribe.
- Excepción: `username` valida `onChange` con debounce de 600ms para comprobar disponibilidad en tiempo real.
- Al hacer submit: se validan todos los campos que no hayan sido tocados aún.

**Estado de error:**
- Mensaje inline bajo el campo. Geist Sans 12px `--destructive`.
- El borde del input cambia a `--destructive` (Capa 3, `className` en el punto de uso).
- Nunca toast para errores de validación — son locales al campo, no eventos globales.

**Estado válido:**
- Sin indicador visual positivo. La ausencia de error es suficiente.
- No hay checkmark verde, no hay borde verde. La sobriedad del diseño aplica a la validación también.

**Campos requeridos:**
- Sin asterisco. Todos los campos de un formulario son requeridos por contexto — el asterisco es ruido.
- El mensaje de error al intentar enviar vacío: "This field is required." (simple, sin dramatismo).

**Implementación:**
- Usar `react-hook-form` + `zod` para todos los formularios. No implementar validación manual.
- El schema Zod es la fuente de verdad de las reglas. Los mensajes de error se definen en el schema.

```ts
const signupSchema = z.object({
  display_name: z.string().min(1, 'This field is required.').max(80),
  username: z.string()
    .min(3, 'At least 3 characters.')
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers, and underscores.'),
  email: z.string().email('Enter a valid email.'),
  password: z.string().min(8, 'At least 8 characters.'),
})
```

---

## Responsive

- Desktop: experiencia completa.
- Mobile: solo lectura. Mensaje amable si intenta escribir.
- Breakpoint principal: `lg` (1024px).

---

## Accesibilidad

- HTML semántico: `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`.
- `aria-label` en iconos sin texto.
- `aria-expanded` en sidebar y sub-items colapsables.
- `aria-current="page"` en nav item activo.
- ShadCN maneja accesibilidad internamente — no sobreescribir sin razón.

---

## Animaciones

CSS transitions por defecto (ver `skill-design.md`). `framer-motion` solo para lo que CSS no puede manejar.

```tsx
// ✓ CSS — sidebar
<nav className="transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.15,1)]" />

// ✓ framer-motion — stagger de cards
<motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} />
```

---

## Checklist antes de entregar

Este checklist cubre lo específico de frontend durante la implementación. Antes de abrir el PR, usar `skill-code-review.md` para la validación completa.

### Velocidad
- [ ] ¿El editor está aislado? ¿Un keystroke no re-renderiza el sidebar ni paneles?
- [ ] ¿El auto-save guarda local primero, sync remoto después?
- [ ] ¿El estado está segmentado en documento / UI / sync / AI?
- [ ] ¿Los paneles secundarios se cargan con lazy load?
- [ ] ¿Ninguna operación de AI bloquea el flujo de escritura?
- [ ] Si el issue toca el critical path, ¿hay trace before/after en `artifacts/perf/`?
- [ ] ¿`npm run ops:perf:gate` pasa para el trace `after` sin `required_failures`?

### Nomenclatura
- [ ] Cada módulo tiene `id`, `data-page`, `data-section`, `data-testid`
- [ ] Clases BEM en PascalCase para identificación semántica
- [ ] Nombres de componentes coinciden con clase BEM

### Visual (verificar contra `.agents/skills/skill-design/vistas.md`)
- [ ] Tokens de color desde CSS variables, nunca hardcoded
- [ ] `font-lora` para contenido epistolar, `font-sans` para UI
- [ ] `strokeWidth={1.5}` en todos los iconos Lucide
- [ ] Bordes `border-[0.5px]`
- [ ] Sombras `shadow-float`, `shadow-float-md`, `shadow-float-lg`
- [ ] Sidebar mini: iconos centrados, labels ocultos, avatar no cortado

### Arquitectura
- [ ] Server Component por default, Client solo si necesario
- [ ] Props tipadas, sin `any`
- [ ] No fetches dentro de componentes de presentación

### Accesibilidad
- [ ] HTML semántico correcto
- [ ] `aria-label` en iconos sin texto
- [ ] Navegación por teclado funcional
