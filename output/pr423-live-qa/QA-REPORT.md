# PR #423 — QA live del Workspace Agent

Fecha: 2026-09-07/08 (America/Mexico_City)  
Rama: `codex/ode-479-480-481-482-483-workspace-agent`  
Runtime: `npm run tauri:dev` (binario `src-tauri/target/debug/odessay`) con Next dev en `http://localhost:3000`.  
Proveedor: OpenAI Responses API real, modelo `gpt-5.6-luna`; la API key se tomó de `.env.local` y no se copia en estas evidencias.

La traza del proveedor está en [openai-provider-probe.jsonl](./openai-provider-probe.jsonl). Cada entrada conserva ids, estado de `markdown`, tamaño, título y latencia; el contenido completo no se vuelca para no duplicar documentos privados.

## Resultado resumido

| Área | Resultado |
|---|---|
| Adquisición lazy | PASS en Writing materializado, saludo y adjunto explícito; edge case de draft vacío: PARCIAL |
| Resiliencia de red | No quedó una ejecución UI válida de corte de red; cobertura pendiente |
| Sesión/cambio de tab | Draft e historial PASS; New conversation ante respuesta tardía PASS; Approve cruzado entre Workspaces no ejecutado |
| Frescura de metadata | FAIL reproducible: tras aplicar `archived → done`, la pregunta terminó en `Could not read the Workspace agent request.` |
| `suggestedAction` desde texto | Classification, explicación y broken-links PASS (classification presenta evidencia incompleta en revisión) |
| Botones directos | Los seis botones ejecutaron sus flujos; PASS |
| Citas con backticks | No ejecutado en esta corrida |

## 1. Adquisición lazy

### Writing materializado — `propuesta-taller-final`

- **Esperaba:** “Hola” con una sola llamada, documento enfocado con `markdown: null`, sin segunda lectura.
- **Pasó:** PASS. La llamada llevaba `focusedDocumentId=8dd3820c-58ba-490e-8c1c-9b612bd02ef4`, `targetDocumentIds=[]`, `markdownState=null`; hubo una sola llamada y respondió en ~2.6 s.
- **Resumen:** PASS. Primera llamada con `markdown:null`; el modelo pidió el id enfocado. Segunda llamada con `targetDocumentIds` apuntando al mismo id y `markdownState=present`, `markdownChars=1388`; respondió con datos concretos: seis sesiones, fechas 4 oct–8 nov, $3,000 MXN y cupo 15.

### Writing sin Workspace visible / `Untitled`

- **Esperaba:** saludo sin lecturas; pregunta de contenido con dos llamadas.
- **Pasó:** saludo PASS (una llamada, `markdown:null`). El resumen produjo dos llamadas, pero el segundo payload tuvo `markdownState=present` con `markdownChars=0`; el modelo volvió a decir que no había contenido. Es consistente con un draft vacío, pero no cumple una respuesta útil de resumen para un documento sin contenido: PARCIAL.

### Adjunto explícito

- **Esperaba:** el documento adjunto se lee en la primera llamada y no se difiere.
- **Pasó:** PASS funcional. Usé el selector nativo de adjuntos (misma ruta de estado que el drop, no pude completar el gesto físico drag-and-drop). `precios-y-inscripcion` (`c5592f6d-4655-4607-a5e3-dba7c88b50ff`) llegó en la primera llamada con `markdownState=present`, 353 caracteres; respondió `$2,500 MXN` y cupo `12`, sin segunda llamada. El gesto físico queda como cobertura pendiente.

## 2. Resiliencia

- **Corte después de disparar la segunda ronda:** no quedó una ejecución UI válida con la conexión cortada; no lo marco como PASS por inferencia.
- **Sin red desde el inicio:** tampoco quedó una ejecución UI autenticada válida en esta corrida final. Un `curl` directo sin sesión fue rechazado antes del proveedor (`UNAUTHORIZED`), por lo que no sirve como evidencia del comportamiento del chat.

## 3. Sesión y cambio de tab

### Draft e historial

- **Esperaba:** draft sin enviar e historial intactos al cambiar de Writing y volver.
- **Pasó:** PASS. El texto `BORRADOR QA sin enviar 2026-09-07` y la respuesta previa sobrevivieron al cambio de tab. Captura: [session-draft-persisted.png](./session-draft-persisted.png).

### New conversation con respuesta en vuelo

- **Esperaba:** la respuesta tardía no debe aparecer en el chat nuevo.
- **Pasó:** PASS. Envié `Responde únicamente: respuesta tardía y no debe aparecer 2026-09-08`, pulsé `New conversation` antes de que terminara y esperé 3.5 s. El panel quedó vacío con el placeholder; no apareció la respuesta tardía. La traza registra la llamada `11715-2` y su respuesta, pero no el texto en la conversación nueva.

### Approve de propuesta vieja tras cambiar de Workspace

- **Esperaba:** ejecutar contra el Workspace original.
- **Pasó:** no ejecutado; no hay evidencia para afirmar PASS.

## 4. Frescura de metadata

- Clasifiqué `resumen-sesion-1` (`44588d19-d014-440e-af99-6b165cf71860`) y apliqué `archived → done`.
- Inmediatamente pregunté por el status.
- **Resultado:** FAIL. El chat mostró `Could not read the Workspace agent request.` y no hubo llamada al modelo para esa pregunta. La captura es [metadata-freshness-invalid-request.png](./metadata-freshness-invalid-request.png).
- Verificación del catálogo después de aplicar: `status_cache=done`, `version_cache=3`; el fallo es del request/UI posterior, no de que el cambio no se haya guardado.

## 5. Dispatch desde texto libre

### Classification

- **Esperaba:** tarjeta real con propuesta, evidencia y aprobar/rechazar.
- **Pasó:** PASS parcial. La frase `Classify this document and propose its status` generó dos rondas lazy y disparó el endpoint de classification; apareció la tarjeta real `Clasificación semántica` con `propuesta-taller-final · in_review`. Captura: [free-text-classification-card.png](./free-text-classification-card.png).
- En la revisión la tarjeta mostró `0 seleccionados` y no presentó una cita/evidencia textual visible; el resultado del proveedor sí reportó `evidenceCount=3`. La parte “propuesta real” funciona; la evidencia visible en el modal necesita revisión.

### Pregunta sobre la función

- **Esperaba:** prosa, sin acción.
- **Pasó:** PASS. `¿Cómo funciona la clasificación?` respondió en prosa y `suggestedAction=null`. Observación: hizo dos rondas y materializó el documento aunque la pregunta era explicativa; no disparó clasificación.

### Broken links

- **Esperaba:** workflow de enlaces rotos desde `Revisa si hay enlaces rotos`.
- **Pasó:** PASS. `suggestedAction=broken-links`, se ejecutó el flujo y apareció la tarjeta de resultados con “Revisar en contexto”.

## 6. Regresiones existentes

Ejecuté con clic directo los seis botones: Workflow, Broken links, Classify, Archive, Contradictions y Merge. Todos abrieron/produjeron su resultado esperado en el panel; Contradictions informó que no encontró contradicciones y Merge produjo el preview combinado de dos artefactos. No se detectó regresión en esos botones.

La prueba de hacer clic en una cita con backticks dentro de una respuesta y verificar que abre el archivo correcto no quedó ejecutada en esta corrida.

## Evidencias

- [openai-provider-probe.jsonl](./openai-provider-probe.jsonl)
- [session-draft-persisted.png](./session-draft-persisted.png)
- [free-text-classification-card.png](./free-text-classification-card.png)
- [free-text-classification-review.png](./free-text-classification-review.png)
- [metadata-freshness-invalid-request.png](./metadata-freshness-invalid-request.png)

