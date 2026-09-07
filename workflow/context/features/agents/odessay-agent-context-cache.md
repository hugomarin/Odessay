# ODESSAY — Cache, Presupuesto y Costo de Contexto

**Contrato objetivo para no recomputar ni pagar contexto innecesariamente.**

## Principio

Un documento ya revisado no debe volver a leerse o resumirse automáticamente en cada turno. Pero “revisado” no es un booleano: es un artifact derivado de una versión concreta, con cobertura y provenance.

```text
document UUID
  + content version/hash
  + representation
  + extraction policy
  = cache key
```

La cache nunca reemplaza al `.md` canónico ni se convierte en fuente de verdad.

## Componentes

```mermaid
flowchart TD
  CATALOG["DocumentCatalog<br/>identity + document version"] --> KEY["Artifact Key"]
  PLAN["Context Acquisition Plan"] --> CACHE["ContextArtifactStore"]
  KEY --> CACHE
  CACHE -->|hit| ARTIFACT["Summary / facts / chunks / citations"]
  CACHE -->|miss| RESOLVE["Context Resolver"]
  RESOLVE --> READ["Read adapter / tool"]
  READ --> CACHE

  ARTIFACT --> BUDGET["ContextBudgetManager"]
  BUDGET --> EVIDENCE["Evidence Bundle"]
  EVIDENCE --> LEDGER["Context Ledger"]
  LEDGER --> AI["AIService adapter"]
  AI --> USAGE["Provider usage<br/>input/output/cache hit"]
  USAGE --> LEDGER
```

## Artifacts versionados

```ts
type ContextArtifact = {
  documentId: string
  documentVersion: string
  representation: "metadata" | "summary" | "facts" | "chunks" | "full"
  content: unknown
  citations: Citation[]
  tokenCount: number
  createdAt: number
  extractionPolicy: string
}
```

Ejemplos:

- `metadata`: título, tipo, estatus, fecha y referencias básicas;
- `summary`: resumen compacto de una versión;
- `facts`: afirmaciones con citas;
- `chunks`: secciones relevantes;
- `full`: contenido completo limitado por presupuesto.

Un resumen de la versión `A@v17` no es automáticamente válido para `A@v18`.

## Presupuesto

El `ContextBudgetManager` pertenece a `Application`. Controla:

- tokens de entrada y salida;
- cantidad de documentos;
- bytes leídos;
- costo estimado;
- número de rondas de recuperación;
- prioridad de fuentes;
- representación máxima permitida.

```ts
type ContextBudget = {
  maxInputTokens: number
  maxOutputTokens: number
  maxDocuments: number
  maxBytes: number
  maxRetrievalRounds: number
}
```

El LLM puede pedir más evidencia, pero la solicitud pasa nuevamente por el planner y el presupuesto. No puede expandir el Workspace sin límite.

## Ledger de consumo

```ts
type ContextLedgerEntry = {
  source: ContextReference
  documentVersion?: string
  representation: string
  tokens: number
  cacheHit: boolean
  reason: string
}
```

El ledger debe permitir responder:

- qué fuentes se consumieron;
- qué versión del documento se usó;
- qué se reutilizó de cache;
- cuántos tokens se enviaron;
- por qué se incorporó cada fuente;
- qué artifacts faltaron o quedaron fuera por presupuesto.

El `AIService` debe reportar el uso real del provider de forma abstracta:

```ts
type AIUsage = {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  estimatedCost?: number
}
```

La cache local y cualquier cache del provider son capas distintas. La cache del provider puede reducir costo/latencia, pero no es una fuente de verdad ni debe ser el único mecanismo de reutilización.

## Invalidación

Invalidar o marcar stale cuando:

- cambia el hash o versión del `.md`;
- cambia la selección o sección solicitada;
- cambia la política de extracción;
- cambia el idioma o formato que afecta la representación;
- una mutación se confirma;
- el catálogo informa un cambio externo;
- se pierde la provenance de una cita.

El watcher y `WorkspaceReconciler` siguen siendo los responsables de proyectar cambios del filesystem hacia manifest y catálogo. El cache de contexto reacciona a la versión resultante; no observa el filesystem por separado.

## Capas de cache

| Capa | Propósito | Owner |
|---|---|---|
| Catalog cache | metadata e identidad consultable | `DocumentCatalog`/adapter |
| Session cache | artifacts temporales de la sesión | `ContextArtifactStore` |
| Semantic cache | resúmenes, facts, chunks y citas versionados | `ContextArtifactStore` |
| Provider cache | optimización de transporte/modelo | `AIService` adapter |

No usar el `DocumentCatalog` como almacén semántico. No usar SQLite como cache paralela sin un contrato específico que respete su ownership operacional actual.

## Ejemplo de ahorro de contexto

```text
Turno 1: revisar documento A@v17
  → leer documento
  → generar summary + facts + citations
  → guardar artifacts

Turno 2: "¿Cuál era la conclusión?"
  → reutilizar summary de A@v17
  → no leer el documento completo

Turno 3: "¿Dónde se demuestra eso?"
  → summary insuficiente
  → cargar chunks relevantes con citas

Turno 4: A cambia a v18
  → artifacts de v17 quedan stale
  → resolver trabaja sobre v18
```

## Estado actual y evolución

El código actual registra parte del historial de sesión y construye evidencia bounded por solicitud, pero aún no tiene un `ContextArtifactStore` ni un `ContextLedger` de tokens. La primera implementación puede usar cache en memoria por sesión y agregar persistencia después, siempre que:

- la clave use UUID y versión, no path;
- el cache sea descartable y derivado;
- el `.md` siga gobernando el contenido;
- la UI no acceda directamente al store;
- los artifacts stale nunca se presenten como evidencia vigente.

## Clasificación arquitectónica

- **Layer dominante:** `Application`.
- **Secundarios:** `Domain` para versionado/provenance; `Adapter` para storage y AI provider.
- **Runtime scope:** `shared-core`, con storage adapters por runtime.
- **Owner:** `architecture-first`.

