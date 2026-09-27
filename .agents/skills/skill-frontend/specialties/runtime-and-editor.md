# Runtime, estado y editor de Odessay

Este recurso describe decisiones y convenciones vigentes de Odessay para este skill. AGENTS.md y los contratos aceptados conservan la precedencia normativa.

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

- aplicar primero la precedencia de AGENTS.md: ADR de identidad cuando cambia el contrato documental; añadir el spec del catálogo cuando cambia la operación desktop de catálogo, apertura, save o sync;
- consultar documentos de dirección, diagnóstico, target architecture y migration plan solo cuando la pregunta dependa de producto, estado vigente, diseño objetivo o secuencia de transición, respectivamente.

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
Zustand — sync state y AI state (solo estos dos slices)
Lucide React — iconografía (strokeWidth={1.5} siempre)
DM Sans para UI, Lora para prosa; Geist reservado al wordmark (ver `.agents/skills/skill-design/SKILL.md`)
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

Si el cambio toca correcciones AI, cargar además `.agents/skills/skill-corrections/SKILL.md` — especializa estos guardrails y declara su enforcement.

Cada guardrail declara cómo se verifica. `no enforcement` significa que solo el review lo atrapa: verificarlo manualmente es obligatorio, no opcional (precedente: el guardrail de "primer match de string" existía aquí y aun así se violó en producción — ver `docs/revision-correcciones-anotaciones-2026-07.md` C1).

- No introducir cambios en decorations sin declarar identidad estable de sugerencia/corrección.
  `enforced by: no enforcement — verificar en review`
- En streaming, descartar chunks stale por identidad/hash de bloque.
  `enforced by: no enforcement — verificar en review`
- Evitar lógica final basada solo en "primer match de string" para correcciones AI en producción.
  `enforced by: no enforcement — el test llega con Fix 1 del plan de docs/revision-correcciones-anotaciones-2026-07.md; hasta entonces, bloqueante en review`
- Cualquier cambio parser/serializer debe validar round-trip Markdown ↔ JSON del subset soportado.
  `enforced by: tests/document-serialization.test.ts (npx vitest run tests/document-serialization.test.ts)`

---

## Velocidad e inmediatez — reglas no negociables

Estas reglas no son optimizaciones opcionales. Son criterios de corrección del producto.

### La velocidad de Odessay es multidimensional

La arquitectura transversal de performance vive en `.agents/skills/skill-performance/SKILL.md`. Frontend conserva únicamente sus invariantes de implementación: editor aislado, datos locales primero cuando aplique, componentes secundarios fuera del camino crítico, hydration con owner claro y listeners coalescidos.

Si el cambio toca vistas, hydration, suscriptores, fetches de bootstrap o componentes en un camino crítico, cargar `skill-performance` y completar su `Performance Architecture Contract`. Este skill no redefine sus dimensiones, budgets ni niveles de evidencia.

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
Una vista de lista pide la lista resumida; una vista de detalle pide el detalle. Si el endpoint actual devuelve más de lo necesario, ampliar el contrato del endpoint (ver `.agents/skills/skill-backend/specialties/api-and-persistence.md` §Peso de respuesta).

**Los suscriptores reactivos coalescen cuando la fuente puede ser bulk.**
`subscribeToLocalDBChanges`, store listeners, `onSnapshot` y similares se montan asumiendo que la operación que los dispara puede ser una hidratación de N filas. Muchos eventos físicos deben producir una actualización lógica; la ventana concreta la define el contrato de performance o el contrato de dominio que corresponda.

```ts
// ✓ Correcto — un burst de 30 writes emite UNA refetch
const debouncedRefetch = useMemo(
  () => debounce(loadRecipientPreviewsAsync, COALESCING_WINDOW),
  [loadRecipientPreviewsAsync],
)
useEffect(() => subscribeToLocalDBChanges(debouncedRefetch), [debouncedRefetch])

// ✗ Incorrecto — N writes = N refetches del mismo endpoint
useEffect(() => subscribeToLocalDBChanges(loadRecipientPreviewsAsync), [loadRecipientPreviewsAsync])
```

### Evidencia del camino crítico

El tipo de evidencia depende del `Performance Architecture Contract`. No todo cambio de frontend requiere el mismo trace.

Cuando el contrato seleccione una prueba de interacción, usar los instrumentos existentes y adjuntar el resultado real. Cuando seleccione escala, probar el consumidor con volúmenes representativos. Cuando no aplique, justificarlo en el brief.

### Anti-patterns de performance (bloqueantes)

- Publicar updates de editor en Zustand o contexto global por keystroke.
- Disparar fetch/sync remoto en cada `onUpdate` sin debounce.
- Mount de paneles secundarios en primera carga sin lazy loading.
- Parseos o transformaciones pesadas en el hilo principal dentro de handlers de input.
- Cálculos de word count/derivados fuera de TipTap en cada tecla.
- Ejecutar lógica AI síncrona en el camino de interacción del editor.
- Introducir dependencias de UI pesadas sin presupuesto de impacto medido.

### Navegación interna vs Navegación de página

**Regla**: Dentro de una misma vista funcional (editor, desk, collections), el cambio de sub-estado NO debe usar `router.push()`.

Las pestañas del editor son **estado interno**, no rutas. El contenido ya está en `localDB`. Usar `router.push()` para cambiar de tab dispara un RSC fetch completo al servidor, un re-render del shell, y una re-hidratación desde cero — todo para mostrar datos que ya están en el navegador.

```tsx
// ✗ INCORRECTO — dispara RSC fetch, re-render completo, re-hidratación
router.push(`/write/${writingId}`)

// ✓ CORRECTO — cambio de estado local, lectura de localDB, URL como espejo
// Mantiene la transición local fuera de una navegación y una hidratación completas.
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

// ✓ CORRECTO — un solo owner de la transición; la URL es espejo pasivo
activateDocument({ writingId: id, href }, "select")  // owner único (ADR documento activo, D2)
// La URL se reescribe como proyección (`href`), sin decidir nada.
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
| Identidad del writing activo | Entre entradas y fuera de la shell: pestaña activa del store de sesión (`lib/stores/editor-session-store.ts`). Dentro de una instancia de `EditorShell`: su identidad de instancia. Ambas escritas solo desde `activateDocument` — `workflow/context/core/odessay-adr-documento-activo.md` (D1 enmendado) | Copiarla de un portador a otro con efectos; decidirla desde la URL; mover a un store compartido algo que lean las limpiezas de la shell sin probar el remontaje |
| Contenido del documento | TipTap internal state | Sincronizar a store global por keystroke |
| Lista de pestañas abiertas | Store de sesión del editor (`editor-session-store`) | Derivar del historial de navegación; mantener una copia en la shell |
| Estado de sync remoto | Zustand sync slice | Leer directamente desde componentes de UI sin selector |

```tsx
// ✗ INCORRECTO — dos fuentes de verdad para la misma dimensión
const [writingId, setWritingId] = useState(params.id)   // fuente A
const currentId = useEditorStore(s => s.writingId)       // fuente B

// ✓ CORRECTO — una sola fuente por alcance, los demás consumen de ella
// Fuera de la shell: suscripción al store de sesión (useSyncExternalStore) o
// getEditorSessionState() en callbacks de larga vida.
// Dentro de EditorShell: la identidad de instancia (currentWritingIdRef), que
// solo escribe activateDocument. Existe porque la shell se remonta en cada
// entrada por URL (ADR documento activo, enmienda de ODE-568); no replicar
// ese patrón fuera de ella.
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
// En EditorShell: `hydrationPhase` ("loading" | "ready"), que solo pone en
// "loading" activateDocument según el motivo (ODE-570).
```

### Prohibición de crear identidad en el hot path

Nunca generar un UUID, crear un registro en localDB ni disparar cualquier efecto secundario de persistencia dentro del handler síncrono de `input`, `paste` o `click`.

```tsx
// ✗ INCORRECTO — identidad creada en el hot path de paste
function handlePaste(e) {
  const id = crypto.randomUUID()      // bloquea el hilo principal
  localDB.writings.save({ id, ... })  // IndexedDB transaction en paste
  setWritingId(id)
  // El usuario puede percibir un bloqueo durante el paste.
}

// ✓ CORRECTO — identidad creada antes de que el usuario interactúe
// El efecto de inicialización genera el UUID cuando el componente monta,
// no cuando llega el evento de input.
useEffect(() => {
  if (!getActiveWritingId()) {
    const id = crypto.randomUUID()
    void localDB.writings.save({ id, body_json: emptyDoc, ... })
      .then(() => activateDocument(id, "create"))  // el único escritor de la identidad activa
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

// ✓ CORRECTO — capa coordinadora única (ADR documento activo, D2)
// activateDocument(target, reason) escribe la identidad de la shell, la
// hidratación y la proyección de la URL; el store se escribe en la misma
// transición y las navegaciones a documento van por navigateToWriting.
// Ningún otro componente decide qué documento está activo.
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
    // 2. Encola sync remoto — background, con la política del contrato de sync
    debouncedSyncRemote()
  }
})
```

Auto-save local: inmediato. Sync remoto: background y coalescido según `odessay-sync.md`. Sin indicador agresivo — solo estado sutil en statusbar.

**Extensión excluida intencionalmente:** `Underline` (Markdown no lo soporta — rompería el round-trip). `Strike`, `Highlight` y `Table` están activas (con shortcuts de teclado deshabilitados en Strike/Highlight). El inventario canónico de extensiones es `lib/editor/extensions.ts` — este listado y el de `odessay-prosemirror-tiptap.md` deben coincidir con él. No agregar ni quitar extensiones sin revisar `odessay-editor.md`.

Shortcuts: `⌘B`, `⌘I`, `⌘K`, `⌘⌥1/2/3`, `⌘⇧F`. Sin toolbar flotante al seleccionar.

---
