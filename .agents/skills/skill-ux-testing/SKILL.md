---
name: skill-ux-testing
description: Prácticas de UX testing y validación E2E de Odessay con Playwright para flujos críticos, aceptación y regresiones. Usar cuando verifiques interacción de usuario, escribas pruebas E2E o evalúes fricción y calidad de experiencia.
---

# Skill: UX & Testing

**Consulta este skill para validar flujos de usuario y escribir tests E2E.**
**Usa Playwright MCP para testear interacciones en el browser.**

---

## Principio rector

Si un flujo no se puede completar sin fricción, no está terminado. Odessay debe sentirse como escribir en papel — cualquier interrupción, confusión o espera innecesaria es un bug.

**La fricción es multidimensional.** El usuario percibe lentitud en cinco dimensiones — no solo cuando el teclado tarda en responder (ver `workflow/context/core/odessay-stack.md §Velocidad multidimensional`). El testing UX cubre las cinco:

1. **Latencia de interacción** — keystroke/click/paste responden < 16 ms.
2. **Tiempo a interactivo** — la página se vuelve útil < 1 s (editor) / < 1.5 s (Desk/Collections/Reading).
3. **Peso transferido** — el bootstrap no descarga megabytes innecesarios.
4. **Forma del waterfall** — el bootstrap hace ≤ 6 fetches distintos, 0 duplicados.
5. **Fan-out reactivo** — un cambio local no dispara cascadas visibles (spinners parpadeando, listas re-renderizando varias veces).

Un flujo terminado se siente fluido en las cinco. Validar solo la primera (con traces de keystroke) deja pasar al producto bugs como "el Desk tarda 60 s en ser usable aunque el editor escriba a 60 fps".

---

## Criterios de aceptación

Cada issue debe tener criterios de aceptación claros. Si no los tiene, pídelos antes de implementar. Los criterios deben ser verificables:

- **Bien:** "El usuario puede crear un writing, escribir texto, y verlo guardado en /desk al recargar."
- **Mal:** "El editor funciona bien."

## Validación de flujos

Antes de entregar un issue que involucra UI, recorre el flujo completo manualmente (o con Playwright):

1. ¿El flujo empieza donde el usuario espera?
2. ¿Cada paso es obvio sin instrucciones?
3. ¿Los estados de carga son sutiles y no bloquean?
4. ¿Los errores se manejan con mensajes amables?
5. ¿El flujo termina donde el usuario espera?

## Paridad cross-mode de presentación textual

Si un issue toca cómo se presenta el contenido de un writing, validar explícitamente paridad entre:

1. `/write/[id]`
2. `/preview/[token]`
3. `/shared/[id]`
4. `/{username}/{slug}`

Qué validar en cada una:
- Tablas anchas: scroll horizontal interno (no en toda la página).
- `pre/code` con URLs largas: wrap multilinea consistente, sin desbordar viewport.
- Links largos en párrafo/celda: misma semántica de break y legibilidad.
- Ausencia de divergencias visuales no intencionales entre superficies.

## Flujos críticos que siempre necesitan test E2E

Estos flujos son el corazón de Odessay. Si alguno se rompe, el producto no funciona:

1. **Registro** — signup → profile creado → llega a /desk.
2. **Escribir** — /write → escribir texto → auto-save → verificar persistencia.
3. **Compartir** — cambiar visibilidad → destinatario puede ver el writing.
4. **Responder** — leer writing → responder → se crea correspondencia.
5. **Invitar** — compartir con email nuevo → generar link → invitado se registra → ve la carta.
6. **AI Editor** — escribir → pausa → observación aparece (o silencio) → descartar.

## Protocolo de performance UX — multidimensional

El protocolo de performance UX se aplica por dimensión. Cuando el `Performance Contract` del brief marca una dimensión como `required`, el testing produce evidencia objetiva de esa dimensión. Cubrir una sola dimensión cuando el diff toca varias es un fallo de testing, no una decisión válida.

### Dimensión 1 — Latencia de interacción (before/after trace)

Obligatorio cuando el issue toca interacción del editor, auto-save, sync o paneles durante escritura.

1. Capturar trace before con el flujo base:

```bash
npm run ops:perf:capture -- --output artifacts/perf/editor-before.json.gz
npm run ops:perf:gate -- --trace artifacts/perf/editor-before.json.gz --report artifacts/perf/editor-before-report.json --metrics artifacts/perf/editor-before-metrics.json
```

2. Implementar el cambio y ejecutar el flujo UX completo (manual o Playwright).
3. Capturar trace after:

```bash
npm run ops:perf:capture -- --output artifacts/perf/editor-after.json.gz
npm run ops:perf:gate -- --trace artifacts/perf/editor-after.json.gz --report artifacts/perf/editor-after-report.json --metrics artifacts/perf/editor-after-metrics.json
```

4. Comparar `editor-before-report.json` vs `editor-after-report.json`.
5. Si `required_failures > 0` en after, el issue no se entrega.
6. Adjuntar al PR las rutas de `artifacts/perf/*` usadas en la comparación.

Qué validar:
- `event_dispatch_ms` (`keydown`, `input`, `paste`, `click`) no cruza umbral de fail.
- `event_timing_ms` (`keydown`, `input`, `click`) no cruza umbral de fail.
- `interaction_latency_ms` se mantiene dentro de presupuesto.
- `long_tasks_ge_50ms` no excede límites de presupuesto.

Fuente de verdad de budgets: `workflow/perf-budgets.json`.

### Dimensión 2 — Tiempo a interactivo (snapshot navegacional)

Obligatorio cuando el issue toca `app/**/page.tsx`, layout, o bootstrap de vista.

1. Abrir la vista en DevTools con cache desactivado y throttling de red `Fast 3G`.
2. Medir desde click/navegación hasta el momento en que el usuario puede operar (editar, hacer click, filtrar).
3. Capturar evidencia: screenshot del Network panel con `DOMContentLoaded` y `Load` visibles, más una nota del tiempo hasta primer flujo útil completable.
4. Adjuntar al PR.

Umbrales:
- Editor (`/write/[id]`): primer paint útil < 1 s, completamente interactivo < 1.5 s.
- Desk / Collections / Reading: primer paint útil < 1 s, todas las acciones (filtros, click en fila, abrir preview) funcionales < 1.5 s.

### Dimensión 3 — Peso transferido (Network panel)

Obligatorio cuando el issue toca rutas de lista en `app/api/**/route.ts`, hidratación cliente, o agrega un fetch al bootstrap.

1. Abrir DevTools Network, filtrar por `Fetch/XHR`, recargar la vista.
2. Sumar el tamaño ungzip de los responses en los primeros 3 s.
3. Para endpoints de lista, verificar que ningún row del response trae `body_json`, `body_text`, ni blobs grandes.
4. Adjuntar al PR: screenshot del Network panel con el total visible, y una nota indicando el endpoint más pesado.

Umbrales:
- Bootstrap acumulado ≤ 200 kB ungzip en los primeros 3 s.
- Endpoint de lista individual ≤ 50 kB ungzip.

### Dimensión 4 — Forma del waterfall (snapshot Network)

Obligatorio en todo issue que toque bootstrap o hidratación.

1. Mismo Network panel; contar requests distintos `Fetch/XHR` en los primeros 3 s.
2. Contar requests duplicados (misma URL + mismos query params) en los primeros 5 s.
3. Adjuntar el screenshot con ambos conteos anotados.

Umbrales:
- ≤ 6 requests distintos en los primeros 3 s.
- 0 requests duplicados en los primeros 5 s.

Si el conteo de duplicados es > 0, la causa más común es un suscriptor reactivo sin debounce o una hidratación llamada desde múltiples mount-time effects sin dedup. Ver `skill-frontend §Hidratación responsable`.

### Dimensión 5 — Fan-out reactivo (test de coalescencia)

Obligatorio cuando el issue toca `lib/local-db/*`, store listeners, o cualquier suscriptor a writes.

1. Ejercitar la operación bulk relevante (hidratación, import, sync) en un test.
2. Verificar que los suscriptores se ejecutan **una sola vez** después del burst, no N veces.
3. Si la fuente emite N eventos por diseño, el suscriptor debe coalescer (debounce 50–150 ms).

Ejemplo de validación en Playwright:

```ts
test("bulk hydration emite UNA refetch en lugar de N", async ({ page }) => {
  const requests: string[] = []
  page.on("request", (r) => {
    if (r.url().includes("/api/writings/shares")) requests.push(r.url())
  })
  await page.goto("/desk")
  await page.waitForLoadState("networkidle")
  expect(requests.length).toBeLessThanOrEqual(1)
})
```

### Cómo elegir qué dimensiones validar

El `Performance Contract` del brief lo declara explícitamente. Si el brief marca tres dimensiones como `required`, el PR adjunta evidencia de las tres. Adjuntar solo la primera porque "es la que ya tenemos automatizada" no es válido.

## Playwright

- Tests en `/tests/`.
- Usa Playwright MCP para ejecutar y debuggear tests desde el agente.
- Naming: `{flujo}.spec.ts`. Ejemplo: `write-and-save.spec.ts`.
- Cada test es independiente. Crea sus propios datos, limpia después.
- Corre contra staging. Nunca contra producción.

### Estructura de un test

```typescript
test('user can write and auto-save a writing', async ({ page }) => {
  // Setup: login as test user
  // Action: navigate to /write, type text, wait for auto-save
  // Assert: reload page, verify text persisted
  // Cleanup: delete test writing
});
```

## Qué no testear con E2E

- Lógica pura de negocio (usar unit tests).
- Validación de schema (usar migraciones + types).
- RLS policies (testear con queries directas en staging).

## Testing del AI Editor

- Verificar que la observación aparece después de pausa.
- Verificar que "SILENCIO" no renderiza nada.
- Verificar que el agente nunca genera texto en la respuesta.
- Verificar que descartar una observación funciona.
- Usar mock del provider AI en tests para no consumir créditos.

## Mobile

- Verificar que las páginas de lectura funcionan en viewport mobile.
- Verificar que /write muestra mensaje de "escritura en desktop" en mobile.
- No testear escritura en mobile — no es un flujo soportado.

---

## Checklist antes de entregar

Este checklist cubre la validación de UX durante la implementación. Antes de abrir el PR, usar `skill-code-review.md` para la validación completa.

- [ ] ¿El flujo completo funciona sin fricción?
- [ ] ¿Los estados de error tienen mensajes amables?
- [ ] ¿Auto-save funciona y se verifica con reload?
- [ ] ¿El flujo funciona en desktop y lectura en mobile?
- [ ] ¿Tests E2E escritos para flujos críticos afectados?
- [ ] ¿No hay UI innecesaria que distraiga?
- [ ] Si el brief marca `Latencia` como required, ¿hay trace before/after y `ops:perf:gate` sin `required_failures`?
- [ ] Si el brief marca `Tiempo a interactivo` como required, ¿hay snapshot de DevTools con timing dentro de presupuesto?
- [ ] Si el brief marca `Peso` como required, ¿hay snapshot del Network panel con tamaño ungzip dentro de presupuesto?
- [ ] Si el brief marca `Waterfall` como required, ¿se anotó el conteo de requests distintos y duplicados?
- [ ] Si el brief marca `Fan-out` como required, ¿hay test que demuestra coalescencia?
- [ ] Si el issue toca presentación textual, ¿hay evidencia de paridad cross-mode (`write`, `preview`, `shared`, `public`)?
