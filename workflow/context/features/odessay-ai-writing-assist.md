# ODESSAY — AI Writing Assist (Corrections + Title Suggestion)

**Documento de referencia para agentes de desarrollo.**
Lee `workflow/context/features/odessay-editor.md`, `workflow/context/features/odessay-sync.md`, `workflow/context/core/odessay-modelo-datos.md` y `workflow/context/core/odessay-stack.md` antes de implementar.

---

## Propósito

Este documento define el contrato operativo de dos funcionalidades AI del editor:

1. **Mechanical corrections** (corrección ortográfica/gramatical conservadora).
2. **Title suggestion** (sugerencia de nombre de writing).

No reemplaza `odessay-ai-editor.md` (editor residente de observaciones). Esta spec cubre el AI assist orientado a micro-correcciones y naming.

---

## Alcance y no-alcance

### Alcance
- Detectar errores mecánicos (ortografía, acentos, typos, concordancia básica, puntuación, spacing, duplicaciones).
- Mostrar correcciones inline por bloque con aceptar/rechazar.
- Sugerir un título en flujo explícito de renombre.

### No-alcance
- Reescritura editorial extensa.
- Cambios de voz/tono del autor.
- Traducción del texto.
- Aplicación automática de cambios sin confirmación del autor.

---

## Contrato de proveedor/modelo (obligatorio)

- Nunca hardcodear IDs de modelo en rutas de negocio.
- Resolver proveedor/modelo por configuración de entorno.
- Si falta configuración requerida, responder error explícito de configuración (no 404 opaco de proveedor).

Variables mínimas para flujo Fireworks:
- `FIREWORKS_API_KEY`
- `FIREWORKS_MODEL`

Política:
- Cambios de modelo son operativos (env), no cambios de código.
- Los docs y briefs deben tratar el modelo como variable temporal, no como constante funcional.

---

## Feature A — Mechanical Corrections

### Objetivo funcional

Corregir errores mecánicos con alta confianza y reemplazos mínimos, preservando voz e intención.

### Trigger esperado

- **Automático**:
  - Debounce por inactividad de escritura.
  - Trigger secundario por cierre de unidad de escritura (párrafo/frase).
- **Manual**:
  - Reanalyze puede existir como acción secundaria.

### Streaming esperado

- Las correcciones llegan en chunks y aparecen progresivamente como decorations.
- El editor no debe bloquearse mientras llegan chunks.
- Chunks stale se descartan de forma determinista.

### Lecciones de QA ODE-143 (2026-05-15)

La prueba manual con textos reales detectó que el flujo sigue siendo frágil cuando se usa como autocorrector:

- En textos largos (>300 palabras) el proveedor puede truncar JSON o devolver prose aunque exista retry. El endpoint debe usar structured outputs (`json_schema`) y un presupuesto de tokens suficiente para el peor caso esperado; el error visible al usuario no debe ser `AI did not return valid correction JSON after retry`.
- Fireworks `response_format: json_schema` debe ser el default para correcciones. `json_object` no es suficiente para garantizar la forma. `prediction` no aplica a este endpoint salvo que se rediseñe como edición de texto completo, porque la salida actual es una lista nueva de hallazgos.
- El streaming real del proveedor puede no emitir chunks útiles de `delta.content`. El UI puede mantener NDJSON propio, pero el backend debe tolerar un flujo provider non-stream estructurado y emitir eventos internos una vez validado el contrato.
- El análisis debe operar por bloques o ventanas con límites explícitos. Evitar pedir una respuesta global no acotada para textos largos.
- Aceptar o rechazar una corrección no debe disparar reanálisis automático. Solo debe mutar el texto/review local, marcar la sugerencia resuelta y esperar acción explícita de Reanalyze o cambio material posterior.
- Las sugerencias duplicadas deben tener identidad estable. No usar ids por índice visible como `spelling-1` si puede haber más de una lista/categoría/render concurrente.

### Estado por bloque (memoria operativa)

Para cada bloque:
- `blockId`
- `currentHash`
- `lastSentHash`
- `lastAckHash`
- `inflightRequestId`

Reglas:
- Solo enviar bloques dirty (`currentHash != lastSentHash`).
- Si cambia un bloque inflight, cancelar/invalidar request anterior.
- Aplicar chunk solo si `sourceHash == currentHash` del bloque.

### Memoria de decisiones del autor

- **Reject**:
  - Persistir fingerprint de rechazo por corrección equivalente.
  - No re-sugerir en snapshot sin cambios materiales.
- **Edición manual**:
  - Invalidar/remapear sugerencias pendientes del rango afectado.
  - No resucitar sugerencias ya resueltas por el autor.

---

## Feature B — Title Suggestion

### Objetivo funcional

Sugerir un único título útil, corto y coherente con el contenido, bajo invocación explícita de usuario.

### Reglas de UX

- No auto-renombrar el writing.
- Mostrar sugerencia como opción "Use suggestion".
- Si el usuario escribe título manual, la decisión manual prevalece.

### Reglas de robustez

- Si contenido insuficiente: devolver error de dominio claro.
- Si falla proveedor: fallback de error de UX sin romper el modal.

---

## Contratos de datos (alto nivel)

### Corrections (canónico)
- `summary`
- `language`
- `corrections[]` por `blockId`
- `uncertain[]`

### Transición

Si existe consumidor legacy, usar adapter explícito de transición.
No deformar prompt canónico para simular contrato viejo.

---

## Criterios de aceptación transversales

- No regresión en `title suggestions` al cambiar flujo de corrections.
- No regresión en endpoints AI no relacionados.
- Logs suficientes para depurar:
  - requestId
  - blockId/sourceHash
  - descarte de chunk stale
  - parse/retry de JSON
- E2E/manual QA obligatorio con:
  - texto corto con 3-5 typos;
  - texto largo de al menos 300 palabras;
  - correcciones repetidas en el mismo texto;
  - aceptar una corrección sin reanálisis automático;
  - cerrar el panel lateral conservando decorations visibles cuando el modo de corrección siga activo.

---

## Referencias de implementación

- `app/api/ai/publication-review/route.ts`
- `app/api/ai/title-suggestions/route.ts`
- `lib/ai/provider-config.ts`
- `lib/editor/publication-suggestion-extension.ts`
- `components/editor/panels/publication-panel.tsx`
