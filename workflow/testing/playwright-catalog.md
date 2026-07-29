# ODESSAY — Catálogo Operativo de Playwright

Este documento organiza los tests y scripts de Playwright que ya existen en Odessay para evitar dos problemas recurrentes:

1. crear tests nuevos sin revisar si ya existe un harness o helper que resuelve el flujo
2. volver a caer en Playwright “exploratorio”, donde el agente pierde tiempo descubriendo login, botones, rutas o selectores inestables

No es un changelog histórico. Es una guía operativa para responder:

> ¿Qué asset de Playwright ya existe, cuál conviene reutilizar y cuál no debería servir como base de un flujo nuevo?

---

## Regla principal

Antes de crear cualquier test nuevo en `tests/playwright/` o cualquier script nuevo de browser automation, el agente debe clasificar los assets existentes en una de estas categorías:

- `usable as-is`
- `usable as pattern`
- `avoid for new work`

No se crea un test nuevo hasta hacer esa clasificación.

---

## Qué hace que un asset sea reutilizable

Un test, helper o script cuenta como buen punto de partida si cumple la mayoría de estas condiciones:

- usa un fixture determinista o una ruta `/perf/*`
- depende de `testid`, helper o selector ya estable
- evita discovery visual/manual de UI
- no cruza auth real salvo que sea estrictamente necesario
- corre bajo `playwright.config.ts` sin setup oculto
- modela una intención reusable, no solo un fix histórico puntual

---

## Arquitectura actual de Playwright

### Config base

- [playwright.config.ts](playwright.config.ts)

Puntos importantes:

- `testDir`: `./tests/playwright`
- `testMatch`: `**/*.e2e.ts`
- `webServer`: `ODE_TEST_LINK_FIXTURES=1 npm run dev`
- `baseURL`: `http://127.0.0.1:3000`
- `workers`: `1`

Implicación:

- el path feliz del repo ya favorece harnesses y fixtures locales
- si un test nuevo necesita un setup paralelo extraño, probablemente está mal orientado

### Helper central actual

- [tests/playwright/helpers/editor.ts](tests/playwright/helpers/editor.ts)

Este helper ya resuelve:

- abrir `editor-harness`
- rehidratar un writing concreto con `/perf/editor-harness/[id]` sin cruzar auth
- cambiar Rich / Markdown
- obtener textarea markdown
- enfocar editor rico
- escribir en editor rico

Regla:

- si un flujo toca editor sobre harness y no reutiliza este helper, la carga de prueba recae en quien propone el nuevo patrón

---

## Inventario por familia

### 1) Editor harness y semántica de edición

Estos tests viven sobre harnesses estables y suelen ser la mejor base para cambios editoriales:

- [tests/playwright/markdown-bold-toggle.e2e.ts](tests/playwright/markdown-bold-toggle.e2e.ts)
- [tests/playwright/markdown-table-html-conversion.e2e.ts](tests/playwright/markdown-table-html-conversion.e2e.ts)
- [tests/playwright/markdown-visual-semantics.e2e.ts](tests/playwright/markdown-visual-semantics.e2e.ts)
- [tests/playwright/editor-find-replace.e2e.ts](tests/playwright/editor-find-replace.e2e.ts)
- [tests/playwright/editor-image-upload.e2e.ts](tests/playwright/editor-image-upload.e2e.ts)
- [tests/playwright/editor-selection-metrics.e2e.ts](tests/playwright/editor-selection-metrics.e2e.ts)
- [tests/playwright/editor-shortcuts.e2e.ts](tests/playwright/editor-shortcuts.e2e.ts)
- [tests/playwright/editor-tab-scroll-restore.e2e.ts](tests/playwright/editor-tab-scroll-restore.e2e.ts)
- [tests/playwright/format-scroll-stability.e2e.ts](tests/playwright/format-scroll-stability.e2e.ts)
- [tests/playwright/rich-bold-selection-boundary.e2e.ts](tests/playwright/rich-bold-selection-boundary.e2e.ts)
- [tests/playwright/footnote-roundtrip.e2e.ts](tests/playwright/footnote-roundtrip.e2e.ts)
- [tests/playwright/highlight-roundtrip.e2e.ts](tests/playwright/highlight-roundtrip.e2e.ts)
- [tests/playwright/orthography-regression-harness.e2e.ts](tests/playwright/orthography-regression-harness.e2e.ts)

Clasificación:

- `usable as pattern`

Cuándo reutilizarlos:

- cambios de semántica Rich/Markdown
- invariantes visuales del editor
- round-trip de estructuras editoriales
- shortcuts
- uploads o tablas en editor

Caso adicional dentro de esta familia:

- `orthography-regression-harness.e2e.ts` cubre correcciones automáticas, invalidación tras edición manual, remap persistido de `blockId`/`blockHash`, y reload/hydration sobre el harness `/perf/orthography-harness`
- clasificarlo como `usable as-is` para regresiones de editor/corrections que necesiten mocks deterministas de review/persist sin auth ni modelo live

Nota:

- esta familia tiene bastante solapamiento; para nuevos cambios no conviene sumar otro test aislado si el flujo cabe razonablemente en uno de estos patrones

---

### 2) Write lifecycle y creación de writings

Assets principales:

- [tests/playwright/write-new-first-paste.e2e.ts](tests/playwright/write-new-first-paste.e2e.ts)
- [tests/playwright/write-blank-lifecycle.e2e.ts](tests/playwright/write-blank-lifecycle.e2e.ts)
- [tests/playwright/write-transient-race.e2e.ts](tests/playwright/write-transient-race.e2e.ts)
- [tests/playwright/write-mobile-gate.e2e.ts](tests/playwright/write-mobile-gate.e2e.ts)
- [tests/playwright/writing-route-canonical.e2e.ts](tests/playwright/writing-route-canonical.e2e.ts)

Clasificación:

- `usable as-is`: `write-new-first-paste`, `write-blank-lifecycle`, `writing-route-canonical`, `write-mobile-gate`
- `usable as pattern`: `write-transient-race`

Cuándo reutilizarlos:

- identidad diferida del writing desktop hasta el primer contenido real
- persistencia local-first inicial
- canonicalización de rutas
- guard de mobile
- regresiones de lifecycle

Contrato vigente (ODE-406):

- `write-blank-lifecycle` verifica cero materializaciones y cero efectos durables antes de contenido
- `write-new-first-paste` verifica exactamente una identidad/materialización tras el primer paste
- en desktop, `/write` no se promueve eager a `/write/{id}` y `Saved locally` no aparece antes de contenido

Overlap conocido:

- `write-new-first-paste` y `write-blank-lifecycle` cubren una zona muy similar

Regla:

- si el cambio toca lifecycle básico de `/write`, extender primero uno de esos dos antes de crear otro archivo nuevo

---

### 3) Preview, shared y superficies de lectura

Assets principales:

- [tests/playwright/preview-valid-token.e2e.ts](tests/playwright/preview-valid-token.e2e.ts)
- [tests/playwright/preview-invalid-token.e2e.ts](tests/playwright/preview-invalid-token.e2e.ts)
- [tests/playwright/preview-revoked-token.e2e.ts](tests/playwright/preview-revoked-token.e2e.ts)
- [tests/playwright/preview-unavailable-operational.e2e.ts](tests/playwright/preview-unavailable-operational.e2e.ts)
- [tests/playwright/preview-overflow-containment.e2e.ts](tests/playwright/preview-overflow-containment.e2e.ts)
- [tests/playwright/preview-shared-margins.e2e.ts](tests/playwright/preview-shared-margins.e2e.ts)
- [tests/playwright/desk-shared-tab.e2e.ts](tests/playwright/desk-shared-tab.e2e.ts)
- [tests/playwright/public-author-mobile.e2e.ts](tests/playwright/public-author-mobile.e2e.ts)
- [tests/playwright/reading-mobile.e2e.ts](tests/playwright/reading-mobile.e2e.ts)

Clasificación:

- `usable as-is`: `preview-valid-token`, `preview-invalid-token`, `preview-revoked-token`, `preview-unavailable-operational`, `desk-shared-tab`, `public-author-mobile`
- `usable as pattern`: `preview-overflow-containment`, `preview-shared-margins`, `reading-mobile`

Cuándo reutilizarlos:

- estados de preview token
- lectura shared/public
- mobile reading
- overflow/containment
- shared margins en preview

Overlap conocido:

- varios tests de `preview-*` cubren la misma superficie con objetivos distintos; para nuevos estados de preview conviene extender esa familia, no crear otra convención

---

### 4) Scripts Playwright orientados a performance

Estos no son tests de producto general. Son scripts operativos para captura de traces:

- [scripts/capture-editor-trace.mjs](scripts/capture-editor-trace.mjs)
- [scripts/capture-editor-image-trace.mjs](scripts/capture-editor-image-trace.mjs)
- [scripts/capture-tab-switch-trace.mjs](scripts/capture-tab-switch-trace.mjs)
- [scripts/capture-reading-trace.mjs](scripts/capture-reading-trace.mjs)
- [scripts/capture-collections-trace.mjs](scripts/capture-collections-trace.mjs)

Clasificación:

- `usable as-is` para evidencia de performance
- `avoid for new product-validation flows`

Regla:

- si el objetivo es aceptación funcional, no uses estos scripts como base
- si el objetivo es `Performance Contract`, estos son el punto de entrada correcto

---

### 5) Patrones históricos que no deberían ser base nueva

- [tests/playwright/ode-126-new-writing-fix.e2e.ts](tests/playwright/ode-126-new-writing-fix.e2e.ts)

Clasificación:

- `avoid for new work`

Razón:

- depende de `playwright-auth.json`
- mezcla fix histórico con auth state persistido
- no es un patrón limpio para cierre de fase o suites nuevas

Regla:

- si necesitas auth para un flujo nuevo, encapsúlala en helper/session setup explícito o usa un harness; no resucites este patrón

---

### 6) DocumentCatalog view consumption (Desk/Workspace)

Familia introducida en Fase 9 M4 (ODE-373). Combina un test de integración que
**monta los consumidores reales** (Desk y Workspace) sobre un DocumentCatalog
mockeado, más tests de contrato del derivador de estado.

- [tests/desk-workspace-catalog-integration.test.tsx](tests/desk-workspace-catalog-integration.test.tsx)
- [tests/document-state.test.ts](tests/document-state.test.ts)

Qué cubren:

- **producción real:** monta el `DeskPage` y el `WorkspaceDetailPrototype` reales
  sobre un catálogo mockeado y verifica que la membresía y el estado salen del
  catálogo (un writing solo-en-IndexedDB que no está en el catálogo NO se
  renderiza; un record solo-en-catálogo SÍ);
- **paridad:** el mismo UUID muestra el mismo estado derivado del catálogo en Desk
  y en Workspace;
- **descubrimiento por watcher:** un burst de cambio del catálogo actualiza Desk
  sin navegar a Workspace;
- **Performance Contract (automatable):** un burst de N cambios coalescen en un
  solo reload (reactive fan-out = 1); Desk renderiza el catálogo local sin esperar
  la hidratación cloud (local-first / TTI);
- derivación única de estado desde `DocumentCatalogRecord` (local-only, synced,
  cloud-only, pending, sync-failed, conflict, ambiguous, stale, rebuilding) y
  prioridad de estados operativos sobre presencia/sync.

Clasificación:

- `usable as-is` para regresiones del consumo de catálogo en Desk/Workspace.

Evidencia que NO corre en esta suite (paso de hardware/app viva):

- el **trace de performance** y el **HAR de red** (waterfall Desk→Studio→Write)
  requieren la app autenticada corriendo; el catálogo SQLite y el
  WorkspaceReconciler además viven en el runtime Tauri (el `webServer` de
  `playwright.config.ts` levanta `npm run dev` web, no el DMG). La evidencia visual
  side-by-side Desk/Workspace y el flujo desktop se capturan sobre el DMG
  empaquetado. Ver `workflow/testing/ode-373-desktop-capture.md`.

---

## Solapamientos actuales que conviene vigilar

### Write lifecycle

- `write-new-first-paste`
- `write-blank-lifecycle`
- `write-transient-race`

Zona compartida:

- creación temprana de identity
- persistencia inicial
- estabilidad de `/write`

Recomendación:

- elegir un test canónico para “lifecycle normal”
- reservar `write-transient-race` para casos de carrera reales

### Preview surface

- `preview-valid-token`
- `preview-invalid-token`
- `preview-revoked-token`
- `preview-unavailable-operational`
- `preview-overflow-containment`
- `preview-shared-margins`

Zona compartida:

- misma superficie base `/preview/*`

Recomendación:

- tratar esta familia como una suite de estados del preview, no como tests inconexos

### Editor semantics

Hay varios tests sobre `editor-harness` con helpers similares.

Recomendación:

- extender helpers primero
- evitar nuevos tests que solo cambian dos pasos de navegación y repiten todo el resto

---

## Protocolo antes de crear un test nuevo

1. Buscar en este catálogo la familia del flujo.
2. Elegir si el asset base será `usable as-is` o `usable as pattern`.
3. Reutilizar helper existente si ya cubre apertura de ruta, cambio de modo o acción central.
4. Si no existe helper y el patrón se repetirá, crear helper antes que otro test duplicado.
5. Si el flujo depende de auth y no hay harness:
   - justificarlo explícitamente
   - evitar archivos persistidos de cookies como patrón por defecto
6. Si el nuevo test se superpone ampliamente con uno actual:
   - preferir extender el existente
   - o declarar por qué la separación añade valor real

---

## Cuándo documentar una nueva familia

Actualizar este catálogo cuando aparezca cualquiera de estas condiciones:

- se crea un nuevo helper reusable
- se introduce una nueva ruta `/perf/*`
- un test deja de ser confiable como patrón
- aparece solapamiento claro entre dos o más tests
- una suite de cierre de fase adopta un flujo maestro nuevo

---

## Regla de mapeo servicio-contrato

Los assets de Playwright y los tests automatizados en general deben poder vincularse a un contrato operativo, no solo a una superficie visual. Esto es especialmente importante para validaciones de cierre de fase.

### Formato

Cuando se cree o modifique un test que valida un servicio, agregar en su metadata o comentario de cabecera:

```ts
/**
 * @contract C1 — Write-path Lifecycle Contract
 * @doc workflow/context/features/odessay-sync.md §Contrato de lifecycle operativo
 * @service DocumentService.save()
 */
```

### Reglas

1. **Un test de servicio sin `contract_ref` es incompleto.** El harness de invariantes puede pasar funcionalmente, pero el contrato subyacente sigue siendo implícito.
2. **Los tests de UI no reemplazan los tests de contrato.** Un test E2E que hace click en "Export" y verifica la descarga no demuestra que el adapter maneja Unicode correctamente; solo demuestra que el flujo funciona para un caso.
3. **Preferir tests de contrato aislados.** Cuando un contrato operativo es crítico (lifecycle, schema, adapter invariant), crear un test unitario o de integración que lo valide directamente, además de cualquier cobertura E2E.

### Checklist para tests nuevos

- [ ] ¿El test valida un contrato operativo documentado?
- [ ] ¿El contrato está referenciado en el test o en su metadata?
- [ ] ¿El test cubre al menos un caso edge del contrato (no solo el happy path)?

---

## Decisión operativa vigente

Para Fase 4 y validaciones de cierre similares:

- preferir harnesses `/perf/*`
- preferir helpers existentes
- construir flujos maestros antes que suites dispersas
- tratar auth real como excepción, no como baseline
- no crear tests nuevos sin pasar antes por este catálogo
- **mapear cada suite de servicio a un contrato operativo explícito**
