# Propuesta de funcionalidad: AI Bulk Organization para writings en Odessay

## Contexto

En la pantalla **Desk**, Odessay ya tiene una lógica de selección múltiple de documentos. La idea es aprovechar esa selección para agregar una funcionalidad de organización asistida por IA.

El problema actual es que, cuando existen muchos writings, algunos quedan con nombres poco descriptivos, nombres temporales o sin una clasificación clara en collections. Esto vuelve difícil navegar la biblioteca y encontrar documentos relevantes.

La funcionalidad propuesta:

> **Seleccionar varios writings y pedirle a la IA que sugiera mejores títulos y collections, sin aplicar cambios automáticamente.**

La IA prepara una propuesta editable; el usuario revisa y acepta.

## 1. Concepto de producto

### Nombre sugerido

```txt
Organize with AI
```

Alternativas:

```txt
Clean up selected writings
Suggest titles & collections
AI organize
```

### Principio central

> **La IA no organiza tu biblioteca por ti; te prepara una propuesta editable para ordenar más rápido.**

Esto es importante porque renombrar documentos y cambiar su clasificación toca la memoria del usuario. No debe ocurrir de forma automática sin revisión.

## 2. Flujo básico de usuario

```txt
Usuario selecciona varios writings
↓
Aparece barra inferior de bulk actions
↓
Click en Organize with AI
↓
Odessay crea un batch job
↓
La IA analiza cada writing
↓
Sugiere título mejorado y collections
↓
Usuario revisa una tabla
↓
Usuario acepta título, collections o ambos
↓
Odessay aplica solo los cambios aceptados
```

### Barra inferior

Actualmente existe una barra de selección múltiple. Se podría extender así:

```txt
5 selected   Select all   Deselect   Status   Collections   Organize with AI   Delete
```

La acción **Organize with AI** debería aparecer solo cuando hay writings seleccionados.

## 3. Qué debe sugerir la IA

La IA debe generar dos tipos de sugerencias:

### 1. Nombre mejorado

Debe tomar el nombre actual y el contenido del writing para sugerir un título más descriptivo.

Ejemplo:

```txt
Original:
Claro. Lo ordenaría como un documento de

Suggested:
Documento de pensamiento sobre estructura de harness
```

### 2. Collections sugeridas

Debe sugerir a qué collections conviene agregar el writing.

Ejemplo:

```txt
Suggested collections:
[Harness] [AI Systems] [Research]
```

Las collections pueden ser:

```txt
Existing collections
New suggested collections
```

Las nuevas collections deben marcarse visualmente antes de crearse.

Ejemplo:

```txt
[Harness] [New: Meeting Intelligence]
```

## 4. Input recomendado para la IA

No conviene usar solo el título actual. Para buenas sugerencias, la IA necesita contexto mínimo.

Input por writing:

```txt
- writingId
- título actual
- excerpt inicial
- status actual
- collections actuales
- tags actuales, si existen
- fecha de creación
- word count
```

### Excerpt recomendado

Usar entre 300 y 800 palabras iniciales del writing.

Si el documento es muy largo, no enviar todo el texto en MVP.

## 5. Output estructurado de la IA

La respuesta debe ser JSON, no texto libre.

```ts
type AiOrganizationSuggestion = {
  writingId: string;
  currentTitle: string;
  suggestedTitle: string;
  suggestedCollections: SuggestedCollection[];
  confidence: "low" | "medium" | "high";
  rationale?: string;
};

type SuggestedCollection = {
  name: string;
  type: "existing" | "new";
};
```

Ejemplo:

```json
{
  "writingId": "abc123",
  "currentTitle": "Spec: Operational Meeting Memory System con",
  "suggestedTitle": "Operational Meeting Memory System con LightRAG",
  "suggestedCollections": [
    { "name": "LightGraph", "type": "existing" },
    { "name": "Meeting Intelligence", "type": "new" }
  ],
  "confidence": "high",
  "rationale": "El texto trata sobre memoria operativa, reuniones y conexión entre conversaciones."
}
```

## 6. Pantalla de revisión

La parte más importante de la feature no es la llamada de IA, sino la pantalla donde el usuario revisa las sugerencias.

### Tabla sugerida

```txt
Original title | Suggested title | Collections | Confidence | Apply
```

Cada fila debe permitir editar antes de aplicar.

Ejemplo:

```txt
Original title                         Suggested title                         Collections                  Apply
01 — Deus Harness Context Brief...      Deus Harness Context Brief             [Harness] [AI Systems]       [✓]
Claro. Lo ordenaría como...             Nota sobre estructura documental        [Writing] [Research]         [✓]
Spec: Operational Meeting...            Operational Meeting Memory System      [LightRAG] [Product]         [✓]
```

### Control granular por fila

Cada fila debería permitir:

```txt
[✓] Apply title
[✓] Apply collections
[Skip]
```

Esto permite aceptar el título sin aceptar las collections, o al revés.

### Botón final

```txt
Apply selected changes
```

## 7. Regla de seguridad de MVP

La IA puede sugerir:

```txt
- Nuevos títulos
- Collections existentes para agregar
- Nuevas collections para crear
```

La IA no debe hacer automáticamente:

```txt
- Renombrar sin revisión
- Crear collections sin confirmación
- Remover collections existentes
- Borrar tags
- Cambiar status
```

### Regla central

```txt
AI can suggest new titles.
AI can suggest collections to add.
AI cannot remove existing collections unless user explicitly enables it.
```

## 8. Necesidad de batch job resiliente

Si el usuario selecciona 50, 100 o 300 writings, la funcionalidad no debe correr como una request larga desde el frontend.

Debe operar como un **batch job persistente y resiliente**.

### Problema a evitar

```txt
Usuario selecciona 100 writings
↓
La IA procesa 49
↓
Falla en el 50
↓
Se pierde todo el trabajo anterior
```

Esto no debe ocurrir.

### Comportamiento esperado

```txt
Usuario selecciona 100 writings
↓
Se crea un Organization Job
↓
Cada writing se procesa de forma independiente
↓
Cada resultado se guarda apenas termina
↓
Si uno falla, los demás continúan
↓
El usuario puede revisar resultados parciales
↓
Si el proceso se rompe, puede reanudarse sin perder progreso
```

## 9. Arquitectura del batch job

### Flujo técnico

```txt
Usuario selecciona writings
↓
POST /api/writings/organize/jobs
↓
Se crea AiOrganizationJob
↓
Se crean AiOrganizationJobItems
↓
Worker procesa items pendientes
↓
Cada item guarda su resultado
↓
Frontend consulta progreso
↓
Usuario revisa sugerencias
↓
Usuario aplica cambios aceptados
```

### Modelo de datos sugerido

```ts
type AiOrganizationJob = {
  id: string;
  userId: string;
  status: "queued" | "running" | "completed" | "failed" | "partial_failed" | "cancelled";
  totalItems: number;
  completedItems: number;
  failedItems: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
};

type AiOrganizationJobItem = {
  id: string;
  jobId: string;
  writingId: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  currentTitle: string;
  suggestedTitle?: string;
  suggestedCollections?: SuggestedCollection[];
  confidence?: "low" | "medium" | "high";
  rationale?: string;
  errorMessage?: string;
  processedAt?: Date;
};
```

## 10. Separar generación y aplicación

La funcionalidad debe tener dos fases:

### Fase 1 — Generate suggestions

```txt
- Procesa cada writing.
- Genera sugerencias.
- Guarda resultados por item.
- No modifica todavía los writings reales.
```

### Fase 2 — Apply accepted changes

```txt
- Usuario revisa tabla.
- Acepta título y/o collections por fila.
- Backend aplica solo lo aceptado.
- Se registra audit log.
```

### Endpoints sugeridos

```txt
POST /api/writings/organize/jobs
GET  /api/writings/organize/jobs/:jobId
GET  /api/writings/organize/jobs/:jobId/items
POST /api/writings/organize/jobs/:jobId/retry-failed
POST /api/writings/organize/jobs/:jobId/apply
```

## 11. Progreso visible para el usuario

Como el proceso puede tardar, el usuario debe poder seguir trabajando mientras corre.

### Señal en sidebar o task panel

```txt
AI Tasks
Organizing writings 37/100
```

Al hacer click:

```txt
Organizing selected writings

37 completed
2 failed
61 pending

[View suggestions] [Cancel]
```

Cuando termina:

```txt
AI organization ready
98 suggestions generated · 2 failed

[Review suggestions]
```

### Principio de UX

```txt
El usuario no debe quedar atrapado esperando en un modal.
El job debe vivir fuera del modal.
El progreso debe ser visible y recuperable.
```

## 12. Revisión parcial antes de terminar

La tabla de review puede mostrar resultados mientras el job sigue corriendo.

```txt
Original title | Suggested title | Collections | Status
Writing A      | Suggested A     | [Harness]    | Completed
Writing B      | Processing...   | —            | Running
Writing C      | Failed          | —            | Retry
```

Esto mejora la percepción de velocidad y permite empezar a revisar antes de que termine todo.

### Regla

```txt
Cada resultado completado debe estar disponible inmediatamente.
No esperar a que termine el batch completo.
```

## 13. Manejo de errores

### Si falla un writing

```txt
- Marcar item como failed
- Guardar errorMessage
- Continuar con el siguiente
- Permitir retry individual o retry failed
```

### Si falla el worker

```txt
- Los items completed quedan guardados
- Los items queued/running pueden reanudarse
- El job puede continuar después
```

### Estados posibles

```txt
Job status:
queued
running
completed
partial_failed
failed
cancelled

Item status:
queued
running
completed
failed
skipped
```

### Regla central

> **Un error en un item no debe cancelar todo el batch.**

## 14. Retry y resiliencia

### Retry por item

Permitir reintentar un item fallido.

```txt
Retry
```

### Retry masivo

Permitir reintentar todos los fallidos.

```txt
Retry failed
```

### Reanudación automática

Si el worker se cae, debe poder buscar items incompletos:

```txt
WHERE status IN ('queued', 'running')
```

Los items que estaban `running` durante un fallo podrían volver a `queued` después de un timeout.

## 15. Infraestructura sugerida

### MVP simple

```txt
- Tabla de jobs en Postgres
- Worker/cron que procesa jobs pendientes
- Polling desde frontend cada 2–5 segundos
```

### Más robusto

```txt
- Inngest
- Trigger.dev
- Temporal
- BullMQ
```

Para una app en Vercel, conviene evaluar **Inngest** o [**Trigger.dev**](http://Trigger.dev) porque resuelven background jobs, retries, steps persistentes y observabilidad.

## 16. Límites y costos

Como esta funcionalidad puede consumir tokens, debe tener límites.

Ejemplo:

```txt
Free:
- No disponible o batch pequeño de prueba

Paid:
- Batch hasta 25/50 writings

Pro:
- Batch hasta 100/300 writings
```

### Rate limiting recomendado

```txt
- Procesar 3–5 writings concurrentes máximo
- Timeout por item
- Reintentos limitados
- Guardar costos por job si se quiere medir uso
```

## 17. Audit log

Cada cambio aplicado debe registrarse.

```ts
type WritingOrganizationChange = {
  writingId: string;
  previousTitle: string;
  newTitle?: string;
  addedCollections?: string[];
  createdCollections?: string[];
  source: "ai_bulk_organize";
  appliedBy: string;
  appliedAt: Date;
};
```

### Objetivo

```txt
- Trazabilidad
- Posible reversión futura
- Confianza del usuario
```

## 18. Reversión futura

No es necesario para MVP, pero conviene diseñar el audit log para permitir una acción futura:

```txt
Undo organization changes
```

Especialmente útil si el usuario acepta muchos cambios y luego se arrepiente.

## 19. Issues sugeridos para Linear

### Issue 1 — Add AI bulk organization action to selected writings

Agregar acción `Organize with AI` en la barra inferior cuando hay writings seleccionados.

Criterios:

```txt
- Visible solo con selección múltiple activa.
- Abre confirmación inicial.
- Explica que no se aplicarán cambios sin revisión.
```

### Issue 2 — Create resilient AI organization job model

Crear modelo de jobs:

```txt
AiOrganizationJob
AiOrganizationJobItem
```

Criterios:

```txt
- Cada writing es un item independiente.
- Guardar status por item.
- Guardar progreso agregado por job.
- Soportar completed, failed, partial_failed y cancelled.
```

### Issue 3 — Generate AI suggestions per writing

Crear lógica para procesar cada writing y generar:

```txt
- suggestedTitle
- suggestedCollections
- confidence
- rationale opcional
```

Criterios:

```txt
- Usar título actual + excerpt + metadata.
- Devolver JSON estructurado.
- Guardar sugerencia por item apenas termina.
```

### Issue 4 — Add sidebar progress indicator for AI jobs

Mostrar progreso del job en sidebar o task panel.

Criterios:

```txt
- Mostrar completed / total.
- Mostrar failed count.
- Permitir abrir review.
- Persistir aunque el usuario cambie de pantalla.
```

### Issue 5 — Support partial failures and retry

Permitir que un item falle sin cancelar todo el job.

Criterios:

```txt
- Marcar item failed.
- Guardar error.
- Continuar con otros items.
- Agregar retry individual y retry failed.
```

### Issue 6 — Add review table for organization suggestions

Crear modal/pantalla de revisión con tabla editable.

Columnas:

```txt
Original title
Suggested title
Suggested collections
Confidence
Apply title
Apply collections
Status
```

Criterios:

```txt
- Suggested title editable.
- Collections editables.
- Permitir skip por fila.
- Permitir revisar resultados parciales.
```

### Issue 7 — Apply accepted organization changes in bulk

Crear endpoint para aplicar solo los cambios aceptados.

Criterios:

```txt
- Renombrar solo writings aceptados.
- Agregar solo collections aceptadas.
- Crear nuevas collections solo con confirmación.
- No remover collections existentes en MVP.
```

### Issue 8 — Add audit log for AI organization changes

Registrar cada cambio aplicado.

Criterios:

```txt
- previousTitle
- newTitle
- addedCollections
- createdCollections
- source = ai_bulk_organize
- appliedBy
- appliedAt
```

### Issue 9 — Add job cancellation

Permitir cancelar jobs en progreso.

Criterios:

```txt
- Items completed se conservan.
- Items queued se marcan cancelled/skipped.
- Items running terminan o se detienen si la infraestructura lo permite.
```

### Issue 10 — Add usage limits for AI organization

Agregar límites por plan y batch size.

Criterios:

```txt
- Definir límite máximo de writings por job.
- Definir concurrencia.
- Manejar errores por límite excedido.
```

## 20. Prioridad recomendada

### P0 — Base funcional y segura

1. Add AI bulk organization action to selected writings.

2. Create resilient AI organization job model.

3. Generate AI suggestions per writing.

4. Persist partial suggestions per writing.

### P1 — UX de revisión

5. Add sidebar progress indicator.

6. Add review table.

7. Apply accepted changes in bulk.

### P2 — Resiliencia avanzada

 8. Support partial failures and retry.

 9. Add audit log.

10. Add job cancellation.

### P3 — Monetización y límites

11. Add usage limits by plan.

12. Add cost tracking per job.

13. Add undo/revert organization changes.

## 21. Principios finales

### Producto

> **La IA prepara una propuesta; el usuario decide.**

### Técnica

> **Nunca pierdas progreso por fallos parciales. Cada writing debe ser una unidad persistente de trabajo.**

### UX

> **El usuario puede seguir trabajando mientras la IA organiza en segundo plano.**

### Scope

> **MVP: sugerir títulos y agregar collections. No remover ni aplicar automáticamente.**
