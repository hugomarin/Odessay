# Flujos críticos de usuario de Odessay

Este recurso conserva fuentes, formatos y escenarios concretos del proyecto. AGENTS.md y los contratos aceptados mantienen la precedencia normativa; el SKILL.md del directorio contiene el método reusable.

## 1. Objetivo

UX Testing comprueba que los flujos de Odessay cumplen criterios observables de interacción, presentación y respuesta mediante recorridos y pruebas al nivel adecuado.

Consultar este recurso al validar los flujos de Odessay o preparar pruebas de recorrido; [UX Testing](../SKILL.md) selecciona el nivel de prueba según el fallo que debe demostrarse.
Cuando el fallo requiere un recorrido real de browser, usar el harness Playwright configurado por el repo y registrar el entorno y el resultado observado.

## 2. Ámbito y activación

Activar al verificar interacción de usuario, preparar o ejecutar pruebas E2E, revisar paridad entre superficies o evaluar fricción de un flujo.

## 3. Entradas y fuentes de autoridad

### Principio rector

Si un flujo no se puede completar sin fricción, no está terminado. Odessay debe sentirse como escribir en papel — cualquier interrupción, confusión o espera innecesaria es un bug.

La arquitectura transversal de performance vive en `.agents/skills/skill-performance/SKILL.md`. UX testing valida la consecuencia observable: que el flujo sea usable, que la espera no sea innecesaria, que los estados terminen y que la evidencia seleccionada por el contrato corresponda al flujo real.

---

### Criterios de aceptación

Cada issue debe tener criterios de aceptación claros. Si no los tiene, pídelos antes de implementar. Los criterios deben ser verificables:

- **Bien:** "El usuario puede crear un writing, escribir texto, y verlo guardado en /desk al recargar."
- **Mal:** "El editor funciona bien."

## 4. Método y criterios

### Validación de flujos

Antes de entregar un issue que involucra UI, recorre el flujo completo manualmente (o con Playwright):

1. ¿El flujo empieza donde el usuario espera?
2. ¿Cada paso es obvio sin instrucciones?
3. ¿Los estados de carga son sutiles y no bloquean?
4. ¿Los errores se manejan con mensajes amables?
5. ¿El flujo termina donde el usuario espera?

### Paridad cross-mode de presentación textual

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

### Flujos críticos y evidencia de integración

Estos flujos son el corazón de Odessay. Cada cambio que los afecte requiere evidencia capaz de falsificar su fallo concreto. Usar E2E cuando el resultado depende del recorrido completo o de la integración entre superficies; para una regla dentro de un owner, usar la prueba más cercana que demuestre el comportamiento. Conservar los E2E existentes como cobertura de regresión del flujo completo.

1. **Registro** — signup → profile creado → llega a /desk.
2. **Escribir** — /write → escribir texto → auto-save → verificar persistencia.
3. **Compartir** — cambiar visibilidad → destinatario puede ver el writing.
4. **Responder** — leer writing → responder → se crea correspondencia.
5. **Invitar** — compartir con email nuevo → generar link → invitado se registra → ve la carta.
6. **AI Editor** — escribir → pausa → observación aparece (o silencio) → descartar.

### Evidencia de performance UX

Cuando el issue activa `skill-performance`, el brief define qué evidencia hace falta. UX testing debe:

- recorrer el flujo completo que el contrato declara;
- observar la transición desde inicio hasta estado útil;
- verificar que loading, error, retry y cancelación tienen salida;
- validar que la prueba usa el mismo runtime, volumen, flags y artifact que se entrega;
- adjuntar el artefacto seleccionado por el contrato, sin exigir traces o snapshots que no representen el riesgo.

Si la evidencia de performance revela una mala forma de carga, el problema vuelve a planning/architecture. No se corrige escondiendo la espera en un test E2E.

### Playwright

- Tests en `/tests/`.
- Usa Playwright MCP para ejecutar y debuggear tests desde el agente.
- Naming: `{flujo}.spec.ts`. Ejemplo: `write-and-save.spec.ts`.
- Cada test es independiente. Crea sus propios datos, limpia después.
- Corre contra staging. Nunca contra producción.

#### Reuse-first obligatorio

Antes de crear un test nuevo o un script nuevo de browser automation, revisar:

- `workflow/testing/playwright-catalog.md`

El agente debe clasificar los assets existentes como:

- `usable as-is`
- `usable as pattern`
- `avoid for new work`

Reglas:

- si ya existe un harness o helper estable para el flujo, reutilízalo
- si el nuevo flujo solo varía un tramo pequeño de uno existente, extiende el test o helper actual antes de crear otro archivo
- si el test propuesto depende de discovery visual, login improvisado, botones ambiguos o rutas sin fixture, probablemente está mal planteado
- auth real debe tratarse como excepción; los harnesses `/perf/*` y fixtures deterministas son el baseline preferido

Para Fase 4 y cierres similares, prioriza flujos maestros de validación sobre colecciones de smoke tests dispersos.

#### Estructura de un test

```typescript
test('user can write and auto-save a writing', async ({ page }) => {
  // Setup: login as test user
  // Action: navigate to /write, type text, wait for auto-save
  // Assert: reload page, verify text persisted
  // Cleanup: delete test writing
});
```

### Testing del AI Editor

- Verificar que la observación aparece después de pausa.
- Verificar que "SILENCIO" no renderiza nada.
- Verificar que el agente nunca genera texto en la respuesta.
- Verificar que descartar una observación funciona.
- Usar mock del provider AI en tests para no consumir créditos.

### Mobile

- Verificar que las páginas de lectura funcionan en viewport mobile.
- Verificar que /write muestra mensaje de "escritura en desktop" en mobile.
- No testear escritura en mobile — no es un flujo soportado.

---

## 5. Resultado y evidencia

### Checklist antes de entregar

Este checklist cubre la validación de UX durante la implementación. Antes de abrir el PR, usar `.agents/skills/skill-code-review/SKILL.md` para la revisión técnica completa.

- [ ] ¿El flujo completo funciona sin fricción?
- [ ] ¿Los estados de error tienen mensajes amables?
- [ ] ¿Auto-save funciona y se verifica con reload?
- [ ] ¿El flujo funciona en desktop y lectura en mobile?
- [ ] ¿La prueba elegida demuestra el fallo relevante del flujo crítico y, cuando depende del recorrido completo, existe evidencia E2E?
- [ ] ¿No hay UI innecesaria que distraiga?
- [ ] Si el issue activa `skill-performance`, ¿el flujo y la evidencia ejecutada corresponden al `Performance Architecture Contract`?
- [ ] ¿La prueba cubre la transición completa, incluidos loading, error, retry y salida?
- [ ] Si el issue toca presentación textual, ¿hay evidencia de paridad cross-mode (`write`, `preview`, `shared`, `public`)?

## 6. Manejo de fallos e incertidumbre

### Qué no testear con E2E

- Lógica pura de negocio (usar unit tests).
- Validación de schema (usar migraciones + types).
- RLS policies (testear con queries directas en staging).

## 7. Relaciones y ownership

Performance define la arquitectura y la evidencia de costo; UX Testing valida la consecuencia observable para el usuario.

## 8. Recursos asociados

Consultar los flujos, rutas y herramientas citados en Método según el alcance del cambio.
