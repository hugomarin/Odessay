# ODESSAY — Ejecución, Tools y Workflows del Workspace Agent

**Contrato objetivo de routing, ejecución y presentación de acciones.**

## No todo es una tool

Una tool es una capacidad ejecutable. Una consulta libre puede resolverse con el LLM y el contexto ya disponible, sin tool ni workflow.

```ts
type AgentIntent =
  | { kind: "conversation" }
  | { kind: "understand" }
  | { kind: "generate" }
  | { kind: "tool"; tool: ToolName }
  | { kind: "workflow"; workflow: WorkflowName }
```

## Caminos de ejecución

```mermaid
flowchart TD
  INPUT["Pregunta o acción"] --> ROUTER["Intent Router"]

  ROUTER --> CONV["Conversation"]
  ROUTER --> READ["Understand / Read"]
  ROUTER --> GEN["Generate / Draft"]
  ROUTER --> TOOL["Direct Tool"]
  ROUTER --> WF["Workflow"]

  CONV --> DIRECT["LLM con contexto mínimo"]
  READ --> READPLAN["Plan de lectura"]
  READPLAN --> READTOOLS["read o resolver de evidencia"]
  GEN --> DRAFT["Borrador / propuesta de texto"]

  TOOL --> VALIDATE["Plan Validator"]
  WF --> RUNNER["Workflow Runner"]
  RUNNER --> VALIDATE

  VALIDATE --> EXEC["Tool Executor"]
  EXEC --> RESULT["Structured Result"]
  DIRECT --> RESPONSE["Agent Response"]
  READTOOLS --> RESPONSE
  DRAFT --> RESPONSE
  RESULT --> PROPOSAL["Proposal<br/>evidence + preconditions + diff"]
  PROPOSAL --> APPROVAL{"¿Usuario acepta?"}
  APPROVAL -->|Sí| MUTATE["write / edit / move / delete"]
  APPROVAL -->|No| RESPONSE
  MUTATE --> RESPONSE
```

## Registry

El agente necesita un registry explícito. El LLM no debe inventar nombres, schemas ni capacidades.

```ts
type AgentCapabilityDescriptor = {
  name: string
  kind: "tool" | "workflow"
  inputSchema: unknown
  outputSchema: unknown
  runtimes: RuntimeKind[]
  requiresApproval: boolean
  mutates: boolean
  requiredCapabilities: string[]
}
```

### Tools atómicas

Las tools actuales del Workspace Agent son:

| Tool | Naturaleza | Aprobación |
|---|---|---|
| `read` | leer evidencia documental | puede tener aprobación de lectura según flujo |
| `write` | crear o reemplazar un documento | sí |
| `edit` | modificar un documento existente | sí |
| `move` | cambiar ubicación/binding permitido | sí |
| `delete` | eliminar o proponer eliminación | sí |

Todas deben resolver primero `DocumentRef → DocumentCatalog → adapter concreto`. Ninguna recibe un UUID y lo interpreta como una ruta.

### Workflows

Los workflows son secuencias declarativas o controladas de tools. Ejemplos:

- `classify`: leer documentos, construir propuestas de tipo/estatus y presentarlas;
- `broken-links`: leer referencias, detectar enlaces rotos y proponer reemplazos;
- `archive-candidates`: calcular candidatos y pedir confirmación;
- `contradictions`: buscar evidencia contradictoria y mostrarla;
- `draft-workflow`: sintetizar una propuesta de `workflow.md` sin escribirla automáticamente.

Un workflow puede fallar, pedir más evidencia o producir cero propuestas. No debe asumir que porque fue invocado tiene permiso de mutar.

## Validación y seguridad

El `PlanValidator` verifica:

- que el tool/workflow exista en el registry;
- que el input cumpla el schema;
- que el runtime soporte la capacidad;
- que las referencias sean resolubles;
- que las precondiciones sigan vigentes;
- que el presupuesto no se haya agotado;
- que la acción tenga el gate de aprobación correcto;
- que la mutación respete el write-path documental.

El LLM puede elegir un camino semántico. No puede saltarse esta validación.

## Proposal y mutación

Las operaciones de cambio siguen este ciclo:

```text
plan
  → evidencia
  → propuesta
  → diff/precondiciones
  → aprobación explícita
  → tool de mutación
  → receipt
  → refresh del catálogo
```

El agente nunca debe escribir directamente al `.md`. La tool delega al `DocumentService` y al adapter correspondiente. En desktop se conserva el orden:

```text
.md atómico
  → manifest atómico
  → SQLite + enqueue
  → sync cloud en background
```

## Agent Response

La ejecución produce un contrato común para chat y detalle:

```ts
type AgentResponse = {
  answer: string
  evidence: EvidenceItem[]
  actions: ActionProposal[]
  status: "complete" | "needs_approval" | "unable"
  contextUsed: ContextReference[]
  receipts?: MutationReceipt[]
}
```

La Card muestra un resumen accionable. El Modal muestra toda la información necesaria para tomar la decisión.

```mermaid
flowchart LR
  RESPONSE["AgentResponse"] --> CARD["Chat Card<br/>respuesta breve + acciones"]
  CARD --> MODAL["Decision Modal<br/>evidencia + diff + precondiciones"]
  MODAL --> PREVIEW["Preview / Open Document<br/>navegación UI"]
  MODAL --> APPROVE["Approve"]
  MODAL --> REJECT["Reject / dismiss"]
  APPROVE --> EXEC["Tool Executor"]
  REJECT --> END["Conservar decisión o terminar"]
```

Abrir un documento citado no es una tool: es una acción de navegación de la interfaz. La UI puede usar el `DocumentRef` de la evidencia para resolver `OpenDocument(UUID)`.

## Consultas libres

| Usuario | Ruta |
|---|---|
| `Hola` | `conversation`, sin lectura documental |
| `Explícame esta idea` | `conversation` o `understand` según haya referencias |
| `Ayúdame a redactar un párrafo` | `generate`, devuelve borrador |
| `Inserta este párrafo` | `generate` + proposal + `edit` tras aprobación |
| `Resúmeme este documento` | `understand`, lectura targeted |
| `Corrige este enlace` | workflow `broken-links` |

## Boundaries

El router y el orquestador viven en `Application`. El registry contiene contratos compartidos. Las implementaciones concretas de `read`, `write`, `edit`, `move` y `delete` viven en adapters o servicios autorizados por runtime.

La UI no puede convertir un botón en una escritura directa. El botón confirma una propuesta; el executor ejecuta la tool.

## Clasificación arquitectónica

- **Layer dominante:** `Application`.
- **Secundarios:** `Domain` para precondiciones; `Adapter` para ejecución; `UI` para Card/Modal.
- **Runtime scope:** `shared-core` + adapters `desktop`, `web` y `cloud`.
- **Owner:** `architecture-first`.

