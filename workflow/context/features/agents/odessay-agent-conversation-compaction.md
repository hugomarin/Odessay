# Odessay Agent — Alcance documental, conversación y compactación

- **Estado:** contrato operativo implementado y usado para validar ODE-513, ODE-515, ODE-509, ODE-510 y ODE-511.
- **Última actualización:** 2026-09-13.
- **Scope:** Workspace Agent, Ask y operaciones semánticas de documentos.
- **Proveedor:** OpenAI Responses API.
- **Autoridad:** este documento gobierna alcance, continuidad, capacidad y evidencia del agente. El ADR de identidad documental sigue gobernando la identidad y el contenido canónico.

## Resultado esperado

El agente trabaja con el alcance documental que la persona selecciona o adjunta. Recibe el contenido completo de esos `.md`, mantiene una conversación por turnos cuando el alcance no cambia y utiliza la capacidad real de la ventana de contexto para decidir si procesa directamente, divide en etapas o solicita una selección más manejable.

Una operación semántica no puede producir un resultado definitivo a partir de documentos incompletos. Si el proveedor no recibió toda la evidencia requerida, el resultado queda explícitamente incompleto y la UI conserva un camino recuperable para continuar o reducir el alcance.

## Verdades del sistema

Hay tres fuentes de verdad distintas y no se sustituyen entre sí:

| Verdad | Autoridad | Uso |
|---|---|---|
| Contenido documental | `.md` canónico | Texto que puede citarse, compararse, fusionarse o modificarse |
| Evidencia consumida | `ContextLedger` + snapshot del catálogo | Qué versión/hash se leyó y qué se envió realmente al modelo |
| Continuidad del proveedor | `response.id` y Items de Responses, incluidos Items de compactación | Mantener estado semántico entre turnos y rondas |

Un resumen o Item compactado de OpenAI nunca reconstruye el `.md`, nunca prueba por sí solo una cita y nunca autoriza una mutación.

## Regla general de alcance

Estas reglas aplican a Ask, Classification, Contradictions, Merge y futuras acciones documentales:

1. Los documentos seleccionados en Workspace o adjuntos al composer forman el alcance explícito de la invocación.
2. Sin selección clara, el agente pregunta qué documentos debe usar. No selecciona documentos recientes ni adivina por nombre, ruta, foco o similitud.
3. Una mención ambigua requiere confirmación de la persona. La metadata del catálogo sirve para ayudar a desambiguar, no para autorizar la lectura del cuerpo.
4. Classification no auto-selecciona documentos para ejecutar una acción; necesita una selección o confirmación explícita.
5. Contradictions acepta un documento o varios: puede detectar una contradicción dentro del mismo documento o entre documentos distintos.
6. Merge requiere al menos dos documentos distintos, pero no tiene un máximo de producto fijo. La cantidad ideal depende de la capacidad efectiva del deployment y del tamaño de cada `.md`.
7. Cambiar Workspace, acción, selección, versión o hash invalida la continuidad semántica previa y comienza un nuevo contexto.

El agente puede reconocer documentos ya incluidos en el alcance durante la conversación. Reconocer una referencia no autoriza incorporar un documento nuevo: si está fuera del alcance, el agente debe pedir que se seleccione o adjunte.

## Estado conversacional

```ts
type WorkspaceAgentConversationState = {
  headResponseId: string | null
  scopeFingerprint: string
  documentSnapshot: Array<{
    documentId: string
    documentVersion: string
    contentHash: string | null
  }>
  compactionCount: number
  contextMode: "native-chain" | "staged-input"
}
```

`scopeFingerprint` identifica Workspace, operación, ids documentales, versiones y hashes. Ask usa `previous_response_id` únicamente cuando el fingerprint del turno actual coincide con el anterior. El System Prompt se reenvía en cada llamada porque OpenAI no hereda `instructions` al continuar con `previous_response_id`.

El chat y el loop semántico de una acción tienen cadenas independientes. La memoria de UI puede guardar un resumen para presentar resultados, pero no sustituye los Items de Responses ni la evidencia versionada del catálogo.

## Evidencia completa, no extractos disfrazados

Los extractos deterministas, alineaciones de headings y candidatos léxicos son ayudas de recall, provenance y navegación. No son el cuerpo documental que decide un veredicto.

Para Contradictions y Merge:

- cada documento seleccionado se lee mediante la ruta autorizada y se incorpora con su `documentId`, versión y `contentHash`;
- el markdown completo se envía al modelo en mensajes ordenados;
- los mensajes grandes se parten únicamente para transporte, sin perder caracteres ni secciones;
- el proveedor recibe un System Prompt que indica que el contenido es evidencia y no instrucciones;
- una respuesta `partial`, `insufficient_evidence` o `incomplete` nunca se presenta como resultado definitivo.

Para Ask, un documento explícitamente seleccionado o el Writing actualmente abierto se envía con su contenido disponible. Sin alcance documental, Ask puede responder una pregunta general, pero para una pregunta que requiere fuentes debe pedir selección; nunca entrega cuerpos adivinados.

## Capacidad y cargas grandes

La capacidad es la ventana real del modelo menos System Prompt, schemas, tools, historial, razonamiento y salida reservada. La cantidad de documentos no es el presupuesto y no debe convertirse en un límite fijo de producto.

El planner de `lib/ai/workspace-context-capacity.ts` puede producir:

- procesamiento directo cuando todo cabe;
- chunks de transporte lossless cuando un `.md` es grande;
- análisis por documento o por lotes de pares/afirmaciones;
- síntesis final después de las etapas;
- recuperación dirigida de rangos solo para confirmar evidencia ya identificada.

El sistema debe sugerir una selección ideal cuando el conjunto excede la capacidad, explicando que la restricción es física y dependiente del deployment. No debe analizar silenciosamente un subconjunto ni usar `truncation: "auto"` para ocultar la falta de contexto.

Cuando no sea posible completar un plan staged, se devuelve `budget_exceeded` o `insufficient_evidence` con los documentos y etapas pendientes. La acción conserva el alcance y deja que la persona reduzca, divida o continúe; no crea un merge incompleto ni promueve una contradicción parcial.

El output también tiene presupuesto. El adapter usa 16.384 tokens por defecto para dejar espacio a envelopes estructurados largos; `OPENAI_WORKSPACE_MAX_OUTPUT_TOKENS` puede sobrescribirse sin bajar de 8.192. Un proveedor que termina en `incomplete` por output agotado no ha producido evidencia válida para materializar.

## Compactación repetible

La compactación es una capacidad esperada de conversaciones largas:

1. Responses se ejecuta con `context_management` y `compact_threshold` cuando el deployment lo declara.
2. Se conserva el `response.id` más reciente y se cuentan los Items de compactación.
3. El turno siguiente continúa con `previous_response_id`; no se eliminan manualmente Items opacos.
4. El proceso puede repetirse varias veces en la misma conversación u operación.
5. Si el contexto compactado no contiene una evidencia necesaria, el resolver vuelve al `.md` canónico usando la versión/hash esperados.
6. Una compactación nunca cambia el alcance ni convierte un resumen en autorización de escritura.

## Política adoptada y ownership

La política de compactación del Workspace Agent es una responsabilidad lógica de Application, aunque no exige una clase con un nombre concreto. Las rutas Ask y semantic staged usan la compactación server-side nativa de Responses (`context_management` con `compact_threshold`) cuando el deployment la configura. Así, OpenAI conserva la ventana operativa y Odessay conserva el `response.id`, los Items opacos y el alcance/evidencia versionados.

`/responses/compact` queda reservado para un flujo explícitamente stateless en el que la aplicación sea dueña del `input` completo y necesite compactarlo fuera de una respuesta normal. No es un requisito adicional para cerrar Ask, Contradictions o Merge, ni se debe implementar un segundo orquestador que recorte o reconstruya manualmente la conversación. La ventana devuelta por ese endpoint, si se adopta en un flujo futuro, se debe pasar como fue devuelta y complementar con evidencia fresca del `.md` cuando una cita lo requiera.

Esta decisión permite varias rondas de compactación sin convertir la compactación en una fuente de verdad documental: la continuidad del proveedor vive en Responses, mientras que el contenido canónico, el snapshot y el `ContextLedger` siguen gobernados por Odessay.

## Pipeline común de una acción

```text
selección explícita
  → lectura completa + snapshot/version/hash
  → cálculo de capacidad y plan directo o staged
  → System Prompt + cuerpos `.md` completos a Responses
  → tool loop de evidencia adicional, si hace falta
  → parseo y validación del envelope estructurado
  → validación server-side de snapshots y confianza
  → propuesta visible y aprobación, si hay mutación
  → materialización por el save path canónico
```

El provider no tiene acceso directo al filesystem. Las lecturas adicionales son read-only, bounded y validadas contra identidad, permisos, versión y capacidad. La escritura siempre es una propuesta aprobada por la aplicación.

## Contradictions y Merge

Contradictions produce relaciones con veredicto, confianza, rationale, provenance y cobertura. Una misma fuente puede aparecer a izquierda y derecha de una relación si la contradicción es interna. Solo una relación de alta confianza, con evidencia suficiente y snapshots vigentes, puede entrar a la cola resoluble.

Merge alinea secciones para presentación, pero el LLM decide equivalencia, complemento, contradicción, irrelevancia o falta de evidencia. No elige por longitud, similitud, timestamp ni “documento más reciente”. Crear el documento solo se habilita con cobertura completa, propuesta válida, conflictos tratados y aprobación; las fuentes quedan sin cambios.

## Criterios de aceptación

El cierre funcional exige respuestas reales de OpenAI Responses API. Los mocks cubren validaciones deterministas, no sustituyen estas pruebas:

1. Dos turnos Ask reales envían el `previous_response_id` del primer Response en el segundo, reenvían el System Prompt y conservan una decisión mencionada antes.
2. Una conversación larga registra al menos dos compactaciones reales; los turnos posteriores conservan la cadena y los Items opacos.
3. Una pregunta sin documentos seleccionados pide alcance cuando requiere evidencia; no auto-selecciona recientes ni envía cuerpos documentales.
4. Un Merge real con dos documentos seleccionados envía los dos `.md` completos, aunque use varios chunks, y devuelve provenance de ambos.
5. Una selección mayor a seis documentos no falla por cardinalidad. Se calcula un plan por capacidad o se solicita dividir la carga; nunca se analiza un subconjunto sin declararlo.
6. Un documento con dos afirmaciones incompatibles produce una relación intra-documento con el mismo `documentId` y rangos distintos.
7. Si cambia el hash o la versión después del análisis, la resolución/escritura se rechaza y no modifica ningún `.md`.
8. Si OpenAI devuelve `incomplete`, `budget_exceeded` o `insufficient_evidence`, no se crea el artefacto ni se presenta una conclusión definitiva.
9. El DMG real ejecuta Ask multi-turno, Classification, Contradictions y Merge con OpenAI real, mostrando receipts con `response.id`, continuidad, tokens, compactaciones, documentos y cobertura.
10. La validación de release distingue el artefacto local funcional del DMG de producción: un endpoint remoto 404 se registra como gap de deployment, no como PASS funcional.

## Pruebas y comandos de referencia

Suite determinista focalizada:

```sh
npx vitest run tests/workspace-context-capacity.test.ts tests/workspace-openai-response.test.ts tests/workspace-agent-relations.test.ts tests/workspace-agent-merge.test.ts
```

Suite completa y build:

```sh
npx tsc --noEmit
npm test
npm run build
git diff --check
```

Ask y compactación contra OpenAI real, aisladas para no consumir cuota por defecto:

```sh
set -a; source .env.local; set +a
RUN_OPENAI_LIVE_TESTS=1 npx vitest run tests/live/workspace-agent-openai.live.test.ts --reporter=dot

set -a; source .env.local; set +a
RUN_OPENAI_LIVE_TESTS=1 RUN_OPENAI_COMPACTION_TESTS=1 \
OPENAI_WORKSPACE_COMPACTION_THRESHOLD_TOKENS=<umbral-válido-del-deployment> \
npx vitest run tests/live/workspace-agent-openai.live.test.ts -t "records at least two" --reporter=dot
```

La prueba live no imprime prompts, cuerpos documentales ni secretos; valida ids, continuidad, salida estructurada y compactaciones.

Validación del DMG local:

```sh
npm run validate:desktop -- --dmg "src-tauri/target/release/bundle/dmg/Artifact Studio_0.7.1_aarch64.dmg" --allow-localhost
```

## Evidencia registrada de esta entrega

- TypeScript: PASS.
- Suite completa: `262 passed | 1 skipped` y `2101 passed | 2 skipped` en las corridas registradas.
- Suite semántica focalizada: `35 passed`.
- Build: PASS; solo warnings preexistentes del editor.
- `ops:delivery:gate`: BLOCKED por la regla de trazabilidad del branch, que compara `origin/main..HEAD` contra ODE-479..ODE-483 aunque esta cadena contiene los issues posteriores ODE-504/509/510/511/513/515. Es un gap del validador/proceso de entrega, no evidencia de fallo semántico; debe resolverse antes del cierre formal.
- Ask real con OpenAI: PASS, dos Responses encadenadas.
- Compactación real: PASS, al menos dos Items de compactación.
- DMG local: PASS para Ask de dos turnos, Contradictions, Classification y Merge con dos documentos seleccionados.
- Validación del bundle: 0 fallos y una advertencia esperada de localhost.
- Gap abierto: el DMG de producción apuntó a `https://odessay.vercel.app/api/ai/workspace-ask` y recibió 404; requiere despliegue de las rutas actuales antes de declarar PASS de producción.

## Referencias

- `workflow/context/core/odessay-adr-identidad.md`
- `workflow/context/features/odessay-desktop-document-catalog.md`
- `workflow/context/features/agents/README.md`
- `workflow/context/features/agents/odessay-agent-context.md`
- `workflow/context/features/agents/odessay-agent-execution.md`
- `workflow/context/features/agents/odessay-agent-context-cache.md`
- `workflow/context/features/agents/odessay-agent-openai-runtime.md`
- `lib/ai/workspace-context-capacity.ts`
- `lib/ai/workspace-openai-response.ts`
- `app/api/ai/workspace-ask/route.ts`
- `app/api/ai/workspace-semantic-round/route.ts`
- [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state?api-mode=responses)
- [OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction)
