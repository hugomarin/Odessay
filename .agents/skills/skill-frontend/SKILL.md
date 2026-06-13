---
name: skill-frontend
description: Arquitectura y estándares de implementación frontend de Odessay (Next.js 15, React, TypeScript). Usa este skill para cualquier decisión de arquitectura de componentes, estructura de archivos, naming conventions, TipTap, Server/Client components, accesibilidad, responsive, y checklist de entrega. Para tokens de color, tipografía, sombras, y guía de ShadCN, consulta skill-design.md primero.
---

# Skill: Frontend (Odessay)

Lee `skill-design.md` antes de implementar cualquier componente con UI.

Lee `.agents/skills/skill-design/vistas.md` antes de implementar cualquier vista. Contiene los valores exactos de padding, tipografía, colores y comportamiento de cada componente en cada vista (Desk, Collections, Correspondences, Reading, Editor), más el checklist de validación para verificar que tu implementación coincide con la referencia visual.
Si el issue toca presentación textual (`.odessay-editor-content`/`.prose-odessay`), leer también `.agents/skills/skill-design/tipografia.md` como fuente de verdad del contrato tipográfico.

## Carga de documentos obligatoria por scope (editor)

Antes de implementar en editor, cargar:
- `workflow/context/features/odessay-editor.md` (siempre)
- `workflow/context/features/odessay-prosemirror-tiptap.md` (si toca TipTap/ProseMirror/extensions/decorations/markdown round-trip)
- `workflow/context/features/odessay-ai-writing-assist.md` (si toca AI corrections, streaming, inline accept/reject o title suggestion)
- `workflow/context/features/odessay-sync.md` (si toca triggers, debounce, navegación interna o estado transicional)

Regla:
- Si el cambio altera el contrato real de estos docs, actualizar el documento correspondiente y registrar la relación en el PR/issue. No dejar implementación desacoplada de spec.
- Si el cambio cruza save path, sync, parser/serializer, services o runtime boundaries, cargar también `.agents/skills/skill-architecture/SKILL.md` antes de decidir la implementación.
- En ese caso, no avanzar solo con intuición de componente: el issue/brief debe declarar `Layer`, `Runtime scope`, `Owner`, `Contracts touched` e `Invariants`. Si faltan, marcar `Context Gap`.

## Arquitectura multi-runtime — awareness obligatoria

Si el cambio toca cualquiera de estas dimensiones:

- save path del editor
- navegación interna que dependa de storage
- sync o hydration
- serializer/parser del documento
- extracción de servicios o boundaries de plataforma
- features pensadas para web y desktop

cargar además, según aplique:

- `workflow/context/features/odessay-desktop-app.md`
- `workflow/context/features/odessay-desktop-migration-diagnostic.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`

Reglas generales:

- No profundizar acoplamientos de UI a `/api/...` si el cambio toca arquitectura o flujos centrales.
- No asumir que el runtime web actual es el modelo final del producto.
- Cuando una decisión afecte portabilidad, pensar en `shared core` vs `web adapter`, no solo en “componente actual”.
- Si un cambio de frontend fuerza una decisión sobre documento canónico, sync o boundaries de servicio, escalar al documento desktop correspondiente en vez de resolverlo localmente dentro del componente.
- Si el change set termina viviendo fuera de `Layer: UI`, frontend no debe “cerrarlo” solo; debe seguir el contrato fijado por `skill-architecture`.

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
Zustand — sync state, AI state y Studio session (tres slices, declarados explícitamente — ver §Estado segmentado)
Lucide React — iconografía (strokeWidth={1.5} siempre)
Geist Sans + Lora — tipografía (ver skill-design.md)
```

---

## Contrato de presentación textual (cross-mode)

Cuando un issue toca renderizado de writings, aplica una sola regla: **el shell puede cambiar, la presentación textual no**.

Superficies cubiertas:
- `/write/[id]`
- `/preview/[token]`
- `/shared/[id]`
- `/{username}/{slug}`

Reglas de implementación:
- Mantener un contrato CSS base compartido (ej. `odessay-rich-content`) para tipografía, wrap y overflow.
- `tables`, `pre/code` y links largos deben comportarse igual entre superficies.
- Wrappers técnicos distintos (`tableWrapper`, wrappers de renderer) son válidos solo si mapean al mismo contrato visual.
- Evitar parches locales por vista; si cambias una regla de presentación textual, sincroniza todas las superficies del contrato en el mismo PR.
- Toda decisión tipográfica (escala, pesos, color de body/strong, ritmo vertical) debe alinearse a `.agents/skills/skill-design/tipografia.md`.

## ProseMirror/Decorations guardrails (obligatorio cuando aplica)

- No introducir cambios en decorations sin declarar identidad estable de sugerencia/corrección.
- En streaming, descartar chunks stale por identidad/hash de bloque.
- Evitar lógica final basada solo en "primer match de string" para correcciones AI en producción.
- Cualquier cambio parser/serializer debe validar round-trip Markdown ↔ JSON del subset soportado.

---

## Reglas de construcción CSS (frontend)

Cuando implementes o refactorices CSS para UI textual:

- Agrupa selectores compartidos para evitar reglas duplicadas entre `.odessay-editor-content` y `.prose-odessay` (por ejemplo `h1/h2/h3`, tipografía base y comportamiento de wrap).
- Separa claramente:
  - `reglas compartidas` (contrato común),
  - `ajustes por superficie` (solo márgenes, spacing o layout específico del shell).
- No declares dos veces la misma propiedad tipográfica para los mismos elementos en modos distintos, salvo que exista una excepción documentada.
- Si agregas una nueva regla textual (tables, `pre/code`, URLs largas, overflow), primero añádela al contrato común y luego solo extiende lo estrictamente necesario por superficie.
- En revisiones CSS, prioriza reducción de divergencia semántica sobre “fixes locales” rápidos.

Patrón recomendado:

```css
.odessay-editor-content h1,
.prose-odessay h1 {
  /* shared rule */
}

.prose-odessay h1 {
  /* surface-specific spacing only */
}
```

---

## Velocidad e inmediatez — reglas no negociables

Estas reglas no son optimizaciones opcionales. Son criterios de corrección del producto.

### La velocidad de Odessay es multidimensional

El frontend defiende cinco dimensiones de velocidad. El editor protege la primera; el resto del árbol React protege las otras cuatro. Si una sola está en rojo, el producto se siente lento aunque las demás estén perfectas. Esta es la versión frontend del contrato fundacional en `workflow/context/core/odessay-stack.md`.

| Dimensión | Cómo se defiende en frontend |
|---|---|
| **Latencia de interacción** | El editor es una isla. Keystroke < 16 ms, sin re-render del shell. Ver `El editor es una isla`. |
| **Tiempo a interactivo** | Cada ruta renderiza desde `localDB` antes de esperar red. El primer paint útil llega < 1 s en editor, < 1.5 s en Desk/Collections/Reading. |
| **Peso transferido** | El cliente nunca pide más de lo que va a mostrar. Si un componente solo necesita títulos, su query no trae `body_json`. |
| **Forma del waterfall** | Las cargas iniciales se deduplican entre llamadores. Un mismo fetch caro se comparte (in-flight promise / TanStack Query) en lugar de repetirse por componente. |
| **Fan-out reactivo** | Los suscriptores a `localDB`/stores hacen debounce si la operación que los dispara puede ser bulk (hidratación, import, sync). |

Todo PR que toque vistas, hidratación, suscriptores a stores o fetches de bootstrap declara su impacto en estas cinco dimensiones en el `Performance Contract`. No hace falta convertir las cinco en evidencia pesada si no aplican; el punto es identificar con precisión cuáles sí cambia el diff y cuáles quedan `not required` con justificación breve. No basta con "el editor sigue rápido": hay que mostrar que el waterfall, el peso y el fan-out no empeoraron cuando el cambio sí los toca.

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

**Sync state, AI state y Studio session — Zustand, tres slices separados**
Son los únicos estados que se comparten entre componentes sin relación directa.

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

// store/studio-session.ts
type StudioSessionState = {
  openArtifactIds: string[]       // artifacts abiertos en Studio, orden de apertura
  addArtifact: (id: string) => void
  removeArtifact: (id: string) => void
  clearSession: () => void
}
```

Estos tres slices son los únicos válidos. El criterio para un nuevo slice es que el estado debe cruzar componentes sin relación directa Y la sesión no debe perderse al navegar entre módulos. Si la condición no se cumple, usar TanStack Query (server data) o useState local (UI state).

### Carga diferida — solo lo esencial en la primera carga

La primera carga incluye únicamente: el documento actual, el editor TipTap, la barra mínima de acciones, y el mecanismo de auto-save local. Todo lo demás entra por lazy load cuando se necesita:

```tsx
// ✓ Lazy load para paneles secundarios
const EditorPanelAI = lazy(() => import('./EditorPanelAI'))
const EditorPanelProperties = lazy(() => import('./EditorPanelProperties'))
const CollectionsOrganizePanel = lazy(() => import('./CollectionsOrganizePanel'))
```

### Hidratación responsable — el read path también es velocidad

El principio local-first nos da velocidad en el write path: el usuario escribe y el editor responde sin esperar a Supabase. Pero la velocidad del read path en bootstrap es responsabilidad explícita del frontend, no algo que el "local-first" garantice por sí solo.

Tres afirmaciones operativas:

**Una sola hidratación remota por sesión, no una por consumidor.**
Si dos o más componentes necesitan los mismos datos al montar, la llamada remota se hace una vez y se comparte. TanStack Query lo resuelve nativamente; cuando no aplica, usar una promise in-flight compartida o un singleton.

```ts
// ✓ Correcto — la hidratación es un singleton; cualquier componente que la pida
//   y haya una llamada en curso recibe la misma promise.
let inFlight: Promise<void> | null = null
export const hydrateWritings = () => {
  if (inFlight) return inFlight
  inFlight = doHydrate().finally(() => { inFlight = null })
  return inFlight
}

// ✗ Incorrecto — cada mount-time effect dispara su propia hidratación.
//   En StrictMode (dev) se duplica; en producción cuesta lo mismo cada vez
//   que aparece un consumidor nuevo.
useEffect(() => { void doHydrate() }, [])
```

**El cliente pide la forma del dato que va a mostrar, no más.**
Una vista de lista pide la lista resumida; una vista de detalle pide el detalle. Si el endpoint actual devuelve más de lo necesario, el remedio es ampliar el contrato del endpoint (ver `skill-backend/SKILL.md §Peso de respuesta`), no aceptarlo como dado.

**Los suscriptores reactivos hacen debounce cuando la fuente puede ser bulk.**
`subscribeToLocalDBChanges`, store listeners, `onSnapshot` y similares se montan asumiendo que la operación que los dispara puede ser una hidratación de N filas. Coalescer múltiples eventos en uno (debounce 50–150 ms) es la postura por defecto, no una optimización.

```ts
// ✓ Correcto — un burst de 30 writes emite UNA refetch
const debouncedRefetch = useMemo(
  () => debounce(loadRecipientPreviewsAsync, 100),
  [loadRecipientPreviewsAsync],
)
useEffect(() => subscribeToLocalDBChanges(debouncedRefetch), [debouncedRefetch])

// ✗ Incorrecto — N writes = N refetches del mismo endpoint
useEffect(() => subscribeToLocalDBChanges(loadRecipientPreviewsAsync), [loadRecipientPreviewsAsync])
```

### Perceived performance — métricas que importan

No optimizar solo para benchmarks. Optimizar para lo que el usuario siente. Estas métricas cubren las cinco dimensiones del contrato, no solo el editor:

| Métrica | Objetivo | Dimensión |
|---|---|---|
| Latencia de keystroke en editor | < 16 ms (60 fps) | Latencia de interacción |
| Tiempo hasta editable (editor) | < 1 s | Tiempo a interactivo |
| Tiempo hasta vista útil (Desk/Collections/Reading) | < 1.5 s desde click hasta poder operar | Tiempo a interactivo |
| Apertura de panel secundario | < 200 ms | Latencia de interacción |
| Respuesta de AI visible | Streaming, primeros tokens < 800 ms | Latencia de interacción |
| Auto-save (local) | Invisible — nunca bloquea | Latencia de interacción |
| Payload XHR acumulado en primer render | ≤ 200 kB en los primeros 3 s | Peso transferido |
| Fetch/XHR distintos en bootstrap de una vista | ≤ 6 en los primeros 3 s | Forma del waterfall |
| Requests duplicados (misma URL + params) | 0 en los primeros 5 s | Forma del waterfall |
| Eventos de cambio emitidos por una operación bulk en `localDB` | 1 (no N) | Fan-out reactivo |

Medir desde el inicio. No al final. Cuando una vista se siente lenta, abrir DevTools Network y leer estas filas antes de tocar código — el cuello rara vez es donde se intuye.

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
- **Spell check evaluando en el mismo tick de escritura.** La evaluación ortográfica debe ocurrir con debounce ≥ 300ms. Evaluar por keystroke provoca subrayados sobre palabras en progreso y bloqueos de estado donde la marca no se limpia.
- Introducir dependencias de UI pesadas sin presupuesto de impacto medido.
- **Await de datos remotos antes de renderizar datos de `localDB`.** La vista debe mostrar lo que tiene localmente de inmediato; el enriquecimiento remoto (shares, metadata, estado de sync) ocurre en background.
- **N+1 fetches en el path de carga inicial de una vista.** Cada item de una lista no debe disparar su propia petición remota. Enriquecer en batch o en background, nunca secuencialmente durante el primer render.

### Navegación interna vs Navegación de página

**Regla**: Dentro de una misma vista funcional (editor, desk, collections), el cambio de sub-estado NO debe usar `router.push()`.

Las pestañas del editor son **estado interno**, no rutas. El contenido ya está en `localDB`. Usar `router.push()` para cambiar de tab dispara un RSC fetch completo al servidor, un re-render del shell, y una re-hidratación desde cero — todo para mostrar datos que ya están en el navegador.

```tsx
// ✗ INCORRECTO — dispara RSC fetch, re-render completo, re-hidratación
// Cuesta 750-1350ms en producción
router.push(`/write/${writingId}`)

// ✓ CORRECTO — cambio de estado local, lectura de localDB, URL como espejo
// Cuesta < 200ms
setActiveWritingId(writingId)  // estado local del editor
// Opcional: actualizar URL sin disparar navegación
window.history.replaceState(null, '', `/write/${writingId}`)
```

**Cuándo SÍ usar `router.push()`**:
- Navegar entre secciones del producto (editor → desk → collections)
- Primer acceso a un recurso que no está en `localDB`
- Links compartidos / acceso directo desde fuera de la app

**Anti-patterns bloqueantes**:
- `router.push()` dentro del editor para cambiar de pestaña
- `router.push()` para cambiar de filtro dentro de una vista
- Usar la URL como `source of truth` para estado que vive en `localDB`
- Confundir "URL debe reflejar el estado" con "URL debe controlar el estado"

**Referencias**:
- `workflow/context/features/odessay-sync.md` — principio de navegación interna, arquitectura local-first, caso de estudio del editor
- `workflow/context/core/odessay-arquitectura.md` — decisión de arquitectura sobre navegación interna vs navegación de página

---

## Consistencia transicional — reglas no negociables para UI local-first

En interfaces local-first, el riesgo principal no es "tener mucho estado", sino permitir que una misma transición sea gobernada por varios owners a la vez. Tabs, route, hydration, localDB y sync remoto pueden co-own una transición crítica. Eso deja puntos ciegos en estados intermedios: el sistema puede recuperarse después de un re-render, pero aun así haber pasado por estados inválidos visibles para el usuario.

Estas reglas son criterios de arquitectura, no optimizaciones opcionales.

### Owner único por transición crítica

Cada transición que cambie el estado observable de la UI debe tener un único owner. No puede haber dos mecanismos distintos que decidan, en paralelo o en secuencia desordenada, cuál es el nuevo estado.

```tsx
// ✗ INCORRECTO — transición co-owned: router y estado local deciden quién controla
router.push(`/write/${id}`)           // owner 1: navegación
setActiveWritingId(id)                // owner 2: estado local
// El orden de resolución depende del event loop y del framework.

// ✓ CORRECTO — un solo owner (estado local), la URL es espejo pasivo
setActiveWritingId(id)                // owner único
window.history.replaceState(null, '', `/write/${id}`)  // espejo, sin decisión
```

**Transiciones críticas en Odessay:**
- Cambio de pestaña en el editor
- Creación de un nuevo writing desde "New writing"
- Cierre de pestaña con persistencia de estado
- Cambio de panel activo en el editor
- Hidratación inicial del editor desde ruta

### Una fuente de verdad por dimensión de estado

No mezclar dimensiones de estado en un mismo store ni replicar la misma dimensión en múltiples lugares.

| Dimensión | Fuente de verdad | Qué NO hacer |
|---|---|---|
| Identidad del writing activo | `currentWritingIdRef` o estado local del editor | Replicar en URL, Zustand y localDB simultáneamente |
| Contenido del documento | TipTap internal state | Sincronizar a store global por keystroke |
| Lista de pestañas abiertas | Estado local del editor-shell | Derivar del historial de navegación |
| Estado de sync remoto | Zustand sync slice | Leer directamente desde componentes de UI sin selector |

```tsx
// ✗ INCORRECTO — dos fuentes de verdad para la misma dimensión
const [writingId, setWritingId] = useState(params.id)   // fuente A
const currentId = useEditorStore(s => s.writingId)       // fuente B

// ✓ CORRECTO — una sola fuente, los demás consumen de ella
const currentWritingIdRef = useRef(params.id)            // fuente única
// Los efectos y handlers leen currentWritingIdRef.current,
// nunca un snapshot de estado que pueda estar stale.
```

### Estados intermedios explícitos, no guards inferidos

Si una transición pasa por un estado intermedio observable, ese estado debe estar modelado explícitamente. No usar `if (x && y && !z)` como proxy de un estado intermedio.

```tsx
// ✗ INCORRECTO — estado intermedio escondido en guards
if (editor && writingId && !isHydrating) {
  editor.commands.setContent(content)
}
// ¿Qué pasa si isHydrating cambia antes de que setContent termine?
// ¿Qué pasa si writingId cambia entre el guard y la ejecución?

// ✓ CORRECTO — estado intermedio modelado con semáforo explícito
const [hydrationPhase, setHydrationPhase] = useState<
  'idle' | 'loading' | 'ready' | 'error'
>('idle')
// La transición es: idle → loading → ready
// Cada fase tiene un handler único y un cleanup explícito.
```

### Prohibición de crear identidad en el hot path

Nunca generar un UUID, crear un registro en localDB ni disparar cualquier efecto secundario de persistencia dentro del handler síncrono de `input`, `paste` o `click`.

```tsx
// ✗ INCORRECTO — identidad creada en el hot path de paste
function handlePaste(e) {
  const id = crypto.randomUUID()      // bloquea el hilo principal
  localDB.writings.save({ id, ... })  // IndexedDB transaction en paste
  setWritingId(id)
  // El usuario ve un freeze de 50-200ms en el paste.
}

// ✓ CORRECTO — identidad creada antes de que el usuario interactúe
// El efecto de inicialización genera el UUID cuando el componente monta,
// no cuando llega el evento de input.
useEffect(() => {
  if (!currentWritingIdRef.current) {
    const id = crypto.randomUUID()
    currentWritingIdRef.current = id
    localDB.writings.save({ id, body_json: emptyDoc, ... })
  }
}, [])
// El paste solo actualiza el contenido — la identidad ya existe.
```

### Prohibición de mezclar mecanismos de navegación/estado

No combinar `router.push()`, `window.history.replaceState()`, `setState` local y updates de Zustand para lograr el mismo cambio de vista. Elegir una capa coordinadora única.

```tsx
// ✗ INCORRECTO — cuatro mecanismos para una sola transición
router.push(`/write/${id}`)           // navegación
setActiveWritingId(id)                // estado local
useWritingStore.getState().setId(id)  // Zustand
window.history.replaceState(...)      // history manual

// ✓ CORRECTO — capa coordinadora única (editor-shell state)
// El editor-shell tiene un único handler: handleSelectWorkspaceTab(id)
// Ese handler actualiza el estado local, y opcionalmente el history.
// Nada más. Ningún otro componente toca la navegación.
```

### Validar transiciones: el checklist de cinco puntos

Antes de mergear cualquier PR que toque una transición crítica, verificar:

1. **Inicio:** ¿Quién dispara la transición? ¿Es el único trigger?
2. **Estado intermedio observable:** ¿Hay un estado entre inicio y final que el usuario pueda ver? ¿Está modelado?
3. **Estado final:** ¿Cuál es el estado final garantizado? ¿Qué pasa si la transición se interrumpe?
4. **Interrupciones:** ¿Qué pasa si ocurre un tab switch, rehidratación, sync tardío o cambio de scope en medio de la transición?
5. **Tests:** ¿El test cubre el estado intermedio, o solo el estado final? Un test que solo verifica "al final está bien" no detecta flicker ni corrupción transitoria.

**Referencia:** `workflow/context/features/odessay-sync.md` — caso de estudio del editor (cambio de pestañas) y reglas de validación de transiciones.

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

**Workspace (`/workspace`):**

```tsx
<section id="workspace" data-page="workspace">
  <div id="workspace-topbar"         data-section="workspace-topbar"         data-testid="workspace-topbar"         className="WorkspaceTopbar" />
  <div id="workspace-list"           data-section="workspace-list"           data-testid="workspace-list"           className="WorkspaceList" />
  <div id="workspace-detail"         data-section="workspace-detail"         data-testid="workspace-detail"         className="WorkspaceDetail" />
  <div id="workspace-detail-table"   data-section="workspace-detail-table"   data-testid="workspace-detail-table"   className="WorkspaceDetailTable" />
</section>
```

**Studio (`/studio`):**

```tsx
<section id="studio" data-page="studio">
  <div id="studio-topbar"            data-section="studio-topbar"            data-testid="studio-topbar"            className="StudioTopbar" />
  <div id="studio-artifact-list"     data-section="studio-artifact-list"     data-testid="studio-artifact-list"     className="StudioArtifactList" />
  <div id="studio-empty"             data-section="studio-empty"             data-testid="studio-empty"             className="StudioEmpty" />
</section>
```

**Preview modal (global, sobre cualquier vista):**

```tsx
<div id="preview-modal" data-section="preview-modal" className="PreviewModal">
  <div id="preview-overlay"          data-section="preview-overlay"          className="PreviewOverlay" />
  <div id="preview-header"           data-section="preview-header"           className="PreviewHeader" />
  <div id="preview-content"          data-section="preview-content"          className="PreviewContent" />
  <div id="preview-properties"       data-section="preview-properties"       className="PreviewProperties" />
</div>
```

El Preview modal usa glass overlay: `backdrop-filter: blur(18px) saturate(1.15)` con fondo blanco semitransparente. Es el único lugar en la app donde se usa `backdrop-filter`. No replicar este patrón en otros modales — los demás usan overlay sólido estándar de ShadCN.

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
  workspace/
    WorkspaceTopbar.tsx
    WorkspaceList.tsx
    WorkspaceCard.tsx
    WorkspaceDetail.tsx
    WorkspaceFolderTreePicker.tsx   ← desktop-only (envuelto con isTauriRuntime())
  studio/
    StudioTopbar.tsx
    StudioArtifactList.tsx
    StudioEmpty.tsx
  preview/
    PreviewModal.tsx               ← glass overlay, "use client"
    PreviewHeader.tsx
    PreviewContent.tsx
    PreviewProperties.tsx
  shared/                          ← componentes compartidos entre vistas
    ArtifactTable.tsx              ← tabla configurable (Desk + Workspace + Studio)
    WritingStatusBadge.tsx         ← badge de status (compact + full variants)
  ui/                              ← ShadCN (no tocar)
```

### Reglas de componentes

- Un componente por archivo. PascalCase coincide con clase BEM.
- Props tipadas con TypeScript interfaces. Sin `any`.
- Si supera ~120 líneas, descomponer.
- Componentes de lista siempre reciben `items` como prop, nunca fetches internos.

---

## Editor TipTap

Siempre `"use client"`. Siempre aislado. El output inmediato del editor en el runtime web actual es ProseMirror JSON (`body_json`) + texto plano (`body_text`). Markdown es hoy un formato de I/O y modo source en web, pero no debe asumirse aquí como una afirmación universal del producto: la estrategia desktop converge a `.md` como contrato documental canónico.

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

Shortcuts: el mapa canónico vive en `lib/editor/shortcuts.ts`. Es la única fuente de verdad — el menú nativo de Tauri y la UI de ayuda deben leer de ahí. No hardcodear shortcuts en componentes individuales. Shortcuts actuales: `⌘B`, `⌘I`, `⌘K`, `⌘⌥1/2/3`, `⌘⇧F`. Sin toolbar flotante al seleccionar.

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
| `/studio` sin artifacts abiertos | "Nothing open. Choose an artifact to work on." | "Open artifact" + "New artifact" |
| `/workspace` sin workspaces | "Add a folder from your computer to start." | "Add workspace" |
| Workspace detail sin archivos | "No files found in this folder." | — |

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
- [ ] ¿La vista renderiza desde `localDB` antes de cualquier `await` remoto?
- [ ] ¿El enriquecimiento de datos (shares, metadata, estado de sync) ocurre en background después del render inicial?

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
- [ ] Si el issue toca presentación de texto: paridad validada entre `write`, `preview`, `shared` y `public` (tablas, `pre/code`, URLs largas, overflow)
- [ ] Reglas CSS compartidas agrupadas sin duplicación innecesaria entre `.odessay-editor-content` y `.prose-odessay`
- [ ] Si hay cambios tipográficos: validados contra `.agents/skills/skill-design/tipografia.md` (escala, ritmo vertical, pesos, color base y `strong`)

### Arquitectura
- [ ] Server Component por default, Client solo si necesario
- [ ] Props tipadas, sin `any`
- [ ] No fetches dentro de componentes de presentación

### Accesibilidad
- [ ] HTML semántico correcto
- [ ] `aria-label` en iconos sin texto
- [ ] Navegación por teclado funcional
