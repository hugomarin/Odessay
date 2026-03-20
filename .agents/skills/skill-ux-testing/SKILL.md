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

## Flujos críticos que siempre necesitan test E2E

Estos flujos son el corazón de Odessay. Si alguno se rompe, el producto no funciona:

1. **Registro** — signup → profile creado → llega a /desk.
2. **Escribir** — /write → escribir texto → auto-save → verificar persistencia.
3. **Compartir** — cambiar visibilidad → destinatario puede ver el writing.
4. **Responder** — leer writing → responder → se crea correspondencia.
5. **Invitar** — compartir con email nuevo → generar link → invitado se registra → ve la carta.
6. **AI Editor** — escribir → pausa → observación aparece (o silencio) → descartar.

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
- Usar mock de Claude API en tests para no consumir créditos.

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
