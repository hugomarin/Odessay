# ODESSAY — Fase 4 Runtime Contract Audit

**Documento de diagnóstico post-remediación.**
Lee `workflow/define/dod-fase-4.md`, `workflow/define/validacion-fase-4.md` y la secuencia `odessay-desktop-*` para el marco arquitectónico.

Este documento analiza las fallas de Fase 4 que ya fueron corregidas (ODE-198 a ODE-202), clasifica cuáles fueron puramente bugs de implementación y cuáles fueron amplificadas por contratos operativos implícitos o débiles, y fija los contratos mínimos que deben existir explícitamente para que fases futuras no repitan los mismos patrones.

---

## 1) Resumen ejecutivo

Fase 4 extrajo servicios (`DocumentService`, `SyncService`, `AIService`, `AuthService`, `SharingService`) y construyó un harness de invariantes (ODE-195). Sin embargo, cinco issues de remediación (ODE-198–ODE-202) revelaron que la estrategia desktop era fuerte en dirección y DoD, pero subespecificada en la capa de contratos operativos entre UI, servicios, adapters y el schema efectivo de producción.

**La tesis operativa de este documento:** un problema de producto también es un problema de contexto cuando el contrato que cruza una frontera runtime no está lo suficientemente explícito como para que BUILD lo descubra sin reconstruirlo desde el historial de incidentes.

---

## 2) Diagnóstico por incidente

### 2.1 ODE-198 — blank-draft identity and version contract

**Fallo observado:** los blank drafts nuevos no propagaban correctamente su número de versión, lo que causaba desincronización entre `EditorShell`, `DocumentService` y `SyncService`.

**Clasificación:**

| Dimensión | Evaluación |
|---|---|
| ¿Era un bug de implementación? | **Sí** — la lógica de asignación de versión en drafts locales tenía un error de propagación. |
| ¿Fue amplificado por un contrato débil? | **Sí** — no existía un contrato explícito de "qué significa la versión en un writing que todavía no tiene identidad remota". La versión se usaba como campo de auditoría, pero su semántica en el lifecycle `local-only → pending → synced` no estaba documentada. |

**Contrato que faltaba:** `BlankDraftVersionContract` — definición de qué campos de un writing local son autoritarios antes de que el servidor confirme la identidad, y cómo se comporta `version` durante esa ventana.

---

### 2.2 ODE-199 — corrections hydration lifecycle-aware

**Fallo observado:** `corrections/persistence.ts` intentaba hidratar correcciones remotas para writings `local-only` y `pending`, generando llamadas a `/api/corrections/hydrate` que fallaban porque el writing no existía remotamente todavía.

**Clasificación:**

| Dimensión | Evaluación |
|---|---|
| ¿Era un bug de implementación? | **Sí** — faltaba un guard que verificara el lifecycle del writing antes de llamar al endpoint remoto. |
| ¿Fue amplificado por un contrato débil? | **Sí** — no existía una matriz de "qué operaciones remotas son válidas para cada estado de lifecycle". Cada servicio asumía implícitamente que el writing era `server-confirmed`. |

**Contrato que faltaba:** `LifecycleAwareRemoteOpsContract` — matriz explícita de qué servicios pueden hacer qué llamadas remotas en cada estado (`local-only`, `pending`, `synced`, `conflict`, `deleted`).

---

### 2.3 ODE-200 — margins adapters vs deployed schema

**Fallo observado:** el código de márgenes asumía columnas modernas (`type`, `text`, `archived`, `resolved`) que no existían en el schema deployado. Cada query fallaba con error 500 hasta que se agregó lógica de fallback legacy.

**Clasificación:**

| Dimensión | Evaluación |
|---|---|
| ¿Era un bug de implementación? | **Parcialmente** — el código escribía contra un schema objetivo sin verificar que el schema deployado lo soportaba. |
| ¿Fue amplificado por un contrato débil? | **Sí, fuertemente** — no existía un contrato de "schema efectivo de producción" vs "schema objetivo de migración". El modelo de datos documentaba el schema deseado, pero no el schema real ni las reglas de transición. |

**Contrato que faltaba:** `EffectiveSchemaContract` — declaración explícita de qué columnas existen en producción, cuáles son legacy, cuáles son nuevas, y qué reglas de fallback deben gobernar durante la transición.

---

### 2.4 ODE-201 — replace_writing_collections RPC vs live schema

**Fallo observado:** el RPC `replace_writing_collections` referenciaba `c.deleted_at IS NULL` en la tabla `collections`, pero esa columna no existía en el schema live. Todas las asignaciones de collections fallaban con `DB_ERROR`.

**Clasificación:**

| Dimensión | Evaluación |
|---|---|
| ¿Era un bug de implementación? | **Sí** — la query usaba una columna inexistente. |
| ¿Fue amplificado por un contrato débil? | **Sí** — no existía un contrato de validación entre el schema documentado en `odessay-modelo-datos.md` y el schema real en Supabase. El RPC era un artefacto SQL que nadie validaba contra el schema deployado. |

**Contrato que faltaba:** `RPCSchemaValidationContract` — regla de que todo RPC, trigger o función SQL nueva debe validarse contra el schema efectivo antes de merge, no solo contra el schema objetivo documentado.

---

### 2.5 ODE-202 — export route unicode-safe filenames

**Fallo observado:** el route handler de export construía un header `Content-Disposition` con el título del writing sin normalizar, causando `ByteString` failure para títulos con caracteres Unicode como `—`.

**Clasificación:**

| Dimensión | Evaluación |
|---|---|
| ¿Era un bug de implementación? | **Sí** — el adapter no sanitizaba el filename antes de usarlo en un header HTTP. |
| ¿Fue amplificado por un contrato débil? | **Sí** — no existía un contrato de "product-valid text vs runtime-valid header". El adapter asumía que todo texto válido para el producto era válido para el transporte web. |

**Contrato que faltaba:** `AdapterInvariantContract` — regla de que todo dato que cruza de producto a infraestructura debe pasar por una capa de normalización que verifique las restricciones del runtime de destino.

---

## 3) Contratos operativos mínimos para fases futuras

Este documento fija cinco contratos operativos que deben existir explícitamente. Cada uno indica dónde vive su definición canónica.

### 3.1 Write-path Lifecycle Contract (C1)

**Qué gobierna:** qué operaciones son válidas para un writing en cada estado del lifecycle local-first.

**Estados canónicos:**

```
local-only  →  pending  →  synced  →  conflict
     ↓            ↓           ↓
   deleted     deleted     deleted
```

**Matriz de operaciones válidas:**

| Operación | local-only | pending | synced | conflict | deleted |
|---|---|---|---|---|---|
| `DocumentService.save()` | ✓ | ✓ | ✓ | ✓ | ✗ |
| `SyncService.enqueuePush()` | ✓ (cuando hay red) | ✓ | ✓ | ✓ | ✗ |
| `AIService.hydrateCorrections()` | ✗ | ✗ | ✓ | ✓ | ✗ |
| `SharingService.shareWriting()` | ✗ | ✗ | ✓ | consultar | ✗ |
| `Export` | ✗ | ✗ | ✓ | ✓ | ✗ |

**Documento canónico:** `workflow/context/features/odessay-sync.md` §Contrato de lifecycle operativo.

**Regla para BUILD:** si un issue toca una operación remota, el brief debe declarar en qué estados de lifecycle es válida. Si no lo declara, BUILD debe marcar `Context Gap`.

---

### 3.2 Effective Production Schema Contract (C2)

**Qué gobierna:** la relación entre el schema documentado, el schema deployado y las reglas de transición.

**Principios:**

1. `odessay-modelo-datos.md` describe el schema objetivo, no necesariamente el schema efectivo.
2. Todo cambio de schema pasa por un estado de transición donde código y schema deployado coexisten con posible divergencia.
3. Durante la transición, el código debe ser forward-compatible (soportar schema futuro) y backward-compatible (no romper schema actual).
4. Un RPC o query SQL no está listo para producción hasta que se valida contra el schema efectivo.

**Documento canónico:** `workflow/context/core/odessay-modelo-datos.md` §Contrato de schema efectivo.

**Regla para BUILD:** si un issue agrega/modifica columnas, tablas o RPCs, el brief debe incluir una nota de transición de schema: "esta columna ya existe en prod / se agregará con migración / requiere fallback legacy".

---

### 3.3 Adapter Invariant Contract (C3)

**Qué gobierna:** qué transformaciones deben ocurrir cuando datos del producto cruzan a infraestructura concreta.

**Casos cubiertos:**

| Producto → Runtime | Ejemplo de invariante |
|---|---|
| Título del writing → Header HTTP | Sanitización RFC 5987; fallback ASCII; no bytes inválidos. |
| `body_json` → Base de datos | Validación de shape mínimo antes de persistencia; no confiar en que TipTap siempre produce JSON válido. |
| Texto del usuario → SQL | Nunca interpolar texto de usuario en queries; usar parametrización. |
| Estado local → Estado remoto | `sync_status` es local-only; nunca enviarlo al servidor. |

**Documento canónico:** `workflow/context/core/odessay-arquitectura.md` §Invariantes de adapter.

**Regla para BUILD:** todo route handler que expone datos del producto al exterior (HTTP, SQL, filesystem) debe documentar qué invariante de adapter aplica. Si no existe, crearla antes de implementar.

---

### 3.4 Margins Synchronization Contract (C4)

**Qué gobierna:** la relación entre la notación de anotación inline del documento y la tabla `margins`.

> Reconciliado con `workflow/context/core/odessay-adr-identidad.md` (D3).

**Invariantes:**

1. El **documento canónico** (`.md` con anotaciones inline `==texto==[@n:..]`) es la fuente de verdad del contenido anotado; `body_json` es la copia de trabajo.
2. `margins` es el payload/índice en la nube para listar, filtrar y compartir, y conserva el estado de colaboración (`resolved/shared/shared_at`) que no vive en el documento.
3. Cada `save` extrae las anotaciones de la copia de trabajo, hace upsert por `id` en `margins`, y elimina filas cuyo `id` ya no existe. **Bloqueante (D3):** el `id` debe codificarse inline para sobrevivir el round-trip; hoy se regenera y este paso borra el estado de colaboración.
4. Durante una transición de schema de `margins`, el adapter debe soportar tanto el schema legacy (`note`) como el schema moderno (`type`, `text`, `archived`, `resolved`).

**Documento canónico:** `workflow/context/features/odessay-margenes.md` §Contrato de sincronización.

---

### 3.5 Collections Assignment Contract (C5)

**Qué gobierna:** la relación entre el RPC `replace_writing_collections`, el schema de `collections` y los permisos de ownership.

**Invariantes:**

1. El RPC solo puede referenciar columnas que existen en el schema deployado de `collections`.
2. `writing_collections` es una relación many-to-many con PK compuesta `(writing_id, collection_id)`.
3. La asignación verifica ownership de la collection (`owner_id = auth.uid()`).
4. No se asume la existencia de columnas de soft-delete (`deleted_at`) en `collections` a menos que estén explícitamente en el schema efectivo.

**Documento canónico:** `workflow/context/features/odessay-collections.md` §Contrato de asignación.

---

## 4) Recomendaciones de documentación

### 4.1 Cambios concretos en el árbol `workflow/context/`

| Documento | Cambio | Justificación |
|---|---|---|
| `workflow/context/core/odessay-modelo-datos.md` | Agregar §"Contrato de schema efectivo" con las reglas C2. | El schema documentado no siempre coincide con el deployado. |
| `workflow/context/core/odessay-arquitectura.md` | Agregar §"Invariantes de adapter" con las reglas C3. | Falta una capa de validación entre producto-valid y runtime-valid. |
| `workflow/context/features/odessay-sync.md` | Agregar §"Contrato de lifecycle operativo" con la matriz C1. | Cada servicio asumía implícitamente que el writing estaba confirmado remotamente. |
| `workflow/context/features/odessay-margenes.md` | Agregar §"Contrato de sincronización" con las reglas C4. | La relación entre `body_json` y `margins` era implícita; el schema transition tampoco estaba gobernado. |
| `workflow/context/features/odessay-collections.md` | Agregar §"Contrato de asignación" con las reglas C5. | El RPC se escribió contra un schema objetivo sin validar el schema efectivo. |
| `workflow/define/validacion-fase-4.md` | Agregar columna "Contract verificado" en la matriz de validación. | La validación de cierre debe mapear servicios a contratos explícitos, no solo a flujos de UI. |
| `workflow/testing/playwright-catalog.md` | Agregar regla de mapeo servicio→contract para assets de validación. | Los tests E2E deben poder vincularse a un contrato operativo, no solo a una superficie visual. |

### 4.2 Regla de oro para futuros briefs arquitectónicos

Todo issue que toque:
- write-path lifecycle
- schema de base de datos
- adapter de infraestructura
- RPC o función SQL

Debe incluir en su `Architecture Contract` uno o más de estos campos obligatorios:

```
Operational Contracts:
  - Lifecycle scope: [local-only | pending | synced | all]
  - Schema transition: [no-change | additive | destructive | requires-fallback]
  - Adapter invariant: [nombre del invariante que aplica]
```

Si no puede completarse, el issue no está listo para BUILD.

---

## 5) Tightening de la validación de cierre

### 5.1 Problema actual

`validacion-fase-4.md` organiza la validación por área y flujo de usuario:

- `DocumentService` → crear → escribir → auto-save → recargar...
- `SyncService` → abrir → hydration → sync visible → retry...

Esto es correcto para validación de producto, pero insuficiente para validación de contratos operativos. Un flujo de UI puede pasar sin que el contrato subyacente esté explícito.

### 5.2 Cambio propuesto

Agregar una dimensión de validación cruzada: **Service-Contract Matrix**.

Para cada servicio validado en Fase 4, se debe poder responder:

1. ¿Qué contrato operativo gobierna este servicio?
2. ¿Dónde vive documentado ese contrato?
3. ¿El código actual respeta el contrato sin reconstruirlo desde implementación?

Ejemplo de entrada para el harness:

```
Service: DocumentService.save()
Contract: C1 (Write-path Lifecycle Contract)
Doc: workflow/context/features/odessay-sync.md §Contrato de lifecycle operativo
Verified: Sí — tests/document-service.test.ts cubre local-only, pending, synced
```

### 5.3 Regla para el harness de invariantes

`scripts/check-phase4-invariants.mjs` debe validar no solo que los tests pasan, sino que cada suite de servicio referencia un contrato operativo canónico. Si una suite no tiene `contract_ref` en su metadata, el harness emite `WARN`.

---

## 6) Ruta de descubrimiento para agentes futuros

Un agente de PLAN/BUILD que llegue a Fase 5 o posterior debe poder descubrir estos contratos sin reconstruirlos desde incidentes. La ruta documental queda así:

```
1. workflow/define/dod-fase-N.md
   ↓ (¿qué bloque del DoD toca este issue?)
2. workflow/context/core/odessay-arquitectura.md §Invariantes de adapter
   ↓ (¿qué capa y runtime toca?)
3. workflow/context/features/odessay-sync.md §Contrato de lifecycle operativo
   workflow/context/core/odessay-modelo-datos.md §Contrato de schema efectivo
   workflow/context/features/odessay-margenes.md §Contrato de sincronización
   workflow/context/features/odessay-collections.md §Contrato de asignación
   ↓ (¿qué invariante específico aplica?)
4. Implementar dentro del contrato
```

Si en algún paso el contrato no existe o es ambiguo, el agente debe marcar `Context Gap` y no improvisar.

---

## 7) Conclusiones

1. **Los cinco incidentes de Fase 4 tenían una componente de implementación y una componente de contrato.** Ninguno fue puramente "código mal escrito"; todos involucraron una frontera donde el contrato era implícito.

2. **La documentación estratégica (dirección desktop, DoD, arquitectura objetivo) no falló.** Falló la capa de contratos operativos que conecta esa estrategia con el código que BUILD produce.

3. **La solución no es más documentación genérica.** Es documentación específica, localizada en los documentos que BUILD ya lee, con reglas verificables.

4. **La validación de cierre debe incluir una dimensión de contrato.** Un flujo de UI que pasa no garantiza que el contrato subyacente sea explícito y reproducible.

5. **Este documento es un artefacto de fase, no un procedimiento permanente.** Su valor está en hacer visibles los contratos que antes eran implícitos. Cuando esos contratos migren a su ubicación canónica en `workflow/context/`, este documento pasa a ser referencia histórica.
