---
name: skill-frontend
description: Arquitectura y estándares de implementación frontend de Odessay (Next.js 15, React, TypeScript). Usa este skill para cualquier decisión de arquitectura de componentes, estructura de archivos, naming conventions, TipTap, Server/Client components, accesibilidad, responsive, y checklist de entrega. Para tokens de color, tipografía, sombras, y guía de ShadCN, consulta skill-design.md primero.
---

# Skill: Frontend (Odessay)

Lee `skill-design.md` antes de implementar cualquier componente con UI.

Lee `skill-design-vistas.md` antes de implementar cualquier vista. Contiene los valores exactos de padding, tipografía, colores y comportamiento de cada componente en cada vista (Desk, Collections, Correspondences, Reading, Editor), más el checklist de validación para verificar que tu implementación coincide con la referencia visual.

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
ShadCN/UI — componentes accesibles, siempre customizados
TipTap — editor headless
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

### Estado segmentado — cuatro dominios separados

Nunca un store global monolítico. Cuatro dominios distintos que no se mezclan:

```ts
// 1. Estado del documento — solo TipTap lo escribe
//    Lee: editor. Escribe: editor. Nadie más.
type DocumentState = { body_json: JSONContent; body_text: string; word_count: number }

// 2. Estado de UI — efímero, local al componente
//    sidebar abierto/cerrado, panel activo, filtro seleccionado
type UIState = { sidebarMini: boolean; activePanel: 'notes' | 'ai' | 'properties' | null }

// 3. Estado de sync — refleja lo que está en la base local y en la nube
//    Nunca bloquea la UI. Solo informa.
type SyncState = { status: 'saved' | 'saving' | 'pending' | 'error'; last_saved_at: Date }

// 4. Estado de AI — completamente asíncrono y desacoplado
//    Las observaciones del AI nunca interrumpen el flujo de escritura
type AIState = { observations: Observation[]; loading: boolean }
```

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

Siempre `"use client"`. Siempre aislado. El output es ProseMirror JSON (`body_json`) + texto plano (`body_text`) en paralelo.

```tsx
"use client"
const editor = useEditor({
  extensions: [
    Document, Paragraph, Text,
    Heading.configure({ levels: [1, 2, 3] }),
    Bold, Italic, Strike, Link,
    Blockquote, BulletList, OrderedList, ListItem,
    History,
    Placeholder.configure({ placeholder: 'Escribe algo...' }),
    CharacterCount,
    // Custom: FootnoteExtension, AIObservationExtension
  ],
  onUpdate: ({ editor }) => {
    // 1. Guarda local primero — inmediato
    saveToLocal({ body_json: editor.getJSON(), body_text: editor.getText() })
    // 2. Encola sync remoto — background, no bloquea
    debouncedSyncRemote(1500)
  }
})
```

Auto-save local: inmediato. Sync remoto: debounce 1500ms. Sin indicador agresivo — solo estado sutil en statusbar.

Shortcuts: `⌘B`, `⌘I`, `⌘K`, `⌘⇧X`, `⌘⌥1/2/3`, `⌘⇧F`. Sin toolbar flotante al seleccionar.

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

### Nomenclatura
- [ ] Cada módulo tiene `id`, `data-page`, `data-section`, `data-testid`
- [ ] Clases BEM en PascalCase para identificación semántica
- [ ] Nombres de componentes coinciden con clase BEM

### Visual (verificar contra `skill-design-vistas.md`)
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
