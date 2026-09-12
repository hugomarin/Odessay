# ODESSAY — OpenAI Responses: observabilidad y runtime

- **Decisión de alcance:** aclarada por Hugo el 2026-09-08.
- **Estado de implementación:** implementado en ODE-513, ODE-515, ODE-509, ODE-510 y ODE-511; diagnóstico inicial sobre `89364b36`.
- **Scope:** Workspace Agent. Correcciones y títulos conservan su provider separado.
- **Autoridad documental:** subordinado al ADR de identidad y al spec de `DocumentCatalog`.

## Intención y causa del Context Gap

Persistencia significa conservar las llamadas en los logs de OpenAI para observabilidad y trazabilidad. El chat de Odessay sigue siendo efímero; no se solicita una base de datos de conversaciones ni recuperación del chat después de reiniciar la aplicación.

| Evidencia | Causa | Clasificación y corrección |
|---|---|---|
| `app/api/ai/workspace-classification/route.ts:112`, `workspace-ask/route.ts:113`, `workspace-tool-presentation/route.ts:113` fijan `store: false`; los helpers devuelven texto/usage sin `response.id` | Se usa Responses pero se desactiva el almacenamiento remoto y se pierde la correlación al adaptar la respuesta | Implementación incompleta respecto al objetivo de observabilidad; ODE-513 habilita almacenamiento y conserva IDs |
| ODE-513 exigía una sesión visible en Conversations y reset por Writing; su añadido exigía background durable | El brief mezcló inspección de llamadas, continuidad del modelo y persistencia de producto | `incomplete-brief`; limitar la aceptación a Responses almacenadas y trazables |
| ODE-514 exigía recuperación tras reload y una ejecución durable de aplicación | Se extrapoló una necesidad de logs a un sistema propio de trabajos persistentes | `incomplete-brief`; usar background nativo como capacidad separada, sin prometer restauración de sesión |
| ODE-509/511/512 exigían QA con Fireworks pese al adapter `openai-workspace-provider-config.ts` | Referencias de provider heredadas sin reconciliación con el código | `stale-doc`; revisión semántica y QA del Workspace Agent con OpenAI Responses |
| ODE-491 decía que solo router y presentación podían llamar IA | Confundía herramientas de mutación deterministas con operaciones de análisis semántico | `stale-doc`; análisis y síntesis pueden llamar al modelo; la escritura aprobada sigue siendo determinista |

El gap de observabilidad no es un conflicto con la arquitectura documental desktop. El chat efímero y el almacenamiento remoto de llamadas son compatibles. La revisión anterior asumió como requisito del usuario la durabilidad adicional escrita en los briefs; esta aclaración retira esa interpretación.

## Reparto entre OpenAI y Odessay

Usar las capacidades nativas de Responses detrás de `AIService`. El adapter traduce el protocolo; no debe reconstruir un motor paralelo de almacenamiento, continuidad o ejecución del proveedor.

| Necesidad | Mecanismo de OpenAI | Responsabilidad de Odessay |
|---|---|---|
| Inspeccionar llamadas | `store: true`, Response ID y Logs → Responses | Correlacionar acción, etapa e invocación con cada respuesta |
| Salidas estructuradas | Structured Outputs e Items de Responses | Validar schema, referencias de evidencia y resultado de producto |
| Solicitudes de tools cuando se incorporen | `function_call` / `function_call_output` y `call_id` | Validar capacidades y aprobaciones; ejecutar la tool local autorizada |
| Continuidad explícita de Ask, si se implementa | `previous_response_id` o Conversations | Mantener el identificador en la sesión en memoria y renovar contexto pertinente |
| Generación larga, ODE-514 | `background: true`, retrieve y cancel | Solicitar/consultar por el ID conocido, mostrar estado y validar el resultado |
| Contexto prolongado, si llega a necesitarse | Compaction nativa | Preservar su ventana de Items opacos; resolver evidencia vigente desde el catálogo |

Responses usa Items distintos para mensajes y llamadas de herramientas; conservarlos en el adapter permite procesar la respuesta sin reducir el protocolo a texto. Las tools locales requieren que Odessay ejecute la operación y devuelva su resultado; OpenAI no recibe acceso implícito al filesystem. [Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses).

Para las tools semánticas incorporadas, el flujo es el loop nativo de function calling de Responses: enviar intención/evidencia y schemas permitidos, recibir `function_call`, validar y ejecutar la lectura por `DocumentCatalog`, devolver `function_call_output` con el mismo `call_id` y continuar hasta un veredicto estructurado o una solicitud acotada de evidencia. La aplicación fija las rondas y el presupuesto. Un diff o matcher determinista puede iniciar el `EvidenceBundle`, pero no es la condición de completitud ni una conclusión del modelo.

Este ciclo sigue el patrón documentado de function calling —el modelo solicita una tool, la aplicación la ejecuta y devuelve su salida— y no requiere adoptar `@openai/agents`. [Function calling](https://developers.openai.com/api/docs/guides/function-calling).

`store: true` permite consultar respuestas almacenadas; la retención estándar documentada es de 30 días. No requiere crear una Conversation. Conversations tiene otra retención y no es criterio de aceptación de observabilidad. Si se incorpora encadenamiento, `previous_response_id` mantiene continuidad del modelo pero el contexto previo sigue teniendo costo de entrada. [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state?api-mode=responses).

## Alcance inmediato — ODE-513

1. Las llamadas reales del Workspace Agent usan OpenAI Responses con `store: true` explícito. Una política de proyecto incompatible se informa como limitación; nunca se promete un log inexistente.
2. Crear un `invocationId` en memoria y correlacionar cada llamada mediante `response.id`, etapa, acción y runtime. Una acción puede producir varias llamadas existentes —análisis, adquisición adicional o presentación— y cada una debe ser identificable sin inventar llamadas para generar logs.
3. Conservar modelo, estado nativo, usage y error/refusal/incomplete como campos separados. El éxito del proveedor no equivale a validez semántica ni aprobación documental.
4. Guardar correlación segura en metadata de OpenAI y emitir logs técnicos con IDs, estado y latencia. No duplicar prompts, cuerpos ni Items completos en logs de aplicación; los Items se procesan en el adapter. La evidencia enviada como input sí forma parte de la llamada almacenada en OpenAI: redacción de metadata no implica que el input esté excluido del almacenamiento.
5. Mantener receipt e historial de UI en memoria. No crear tablas, colas durables de AI ni historial de chat en Supabase, SQLite o IndexedDB.
6. Probar una acción real y localizar su Response en el proyecto OpenAI correspondiente mediante su ID. Conversations y Agents SDK no son gates de cierre.

La detección de Broken links/Archive es determinista, pero su presentación actual sí puede llamar OpenAI y debe registrarse como etapa `presentation`. Contradictions y Merge ya tienen análisis semántico real mediante el loop de Responses: sus veredictos, evidencia y cobertura se validan antes de entrar a la UI. Ask ya devuelve `suggestedAction` y puede solicitar evidencia; no es correcto afirmar que el LLM nunca decide acciones.

## Capacidades separadas del objetivo de logs

- **Continuidad:** no es prerrequisito de ODE-513. Si se incorpora, conservar `AgentSession` al navegar (ODE-502), asociar cada ejecución a su contexto original y distinguir navegación de cambios reales de evidencia. No resetear la sesión visible por cambiar de Writing.
- **Background:** ODE-514 describe generación remota asíncrona. La app puede consultar y cancelar mientras conserva el ID en su sesión; cerrar la app no cancela implícitamente la generación remota. La recuperación automática del chat o de trabajos después de reload/restart queda fuera del alcance actual. No se necesita una cola propia para habilitar los logs.
- **Retención de background:** la guía vigente permite `store: false` con almacenamiento temporal y describe ventanas de aproximadamente diez minutos según política. Para inspección remota, mantener `store: true` explícito y verificar la política real del proyecto. [Background mode](https://developers.openai.com/api/docs/guides/background).
- **Compaction:** capacidad futura, sin implementación exigida por 513/514. Usar la ventana devuelta sin podar ni reinterpretar sus Items opacos; no convertirla en evidencia documental. [Compaction](https://developers.openai.com/api/docs/guides/compaction).
- **Agents SDK y Steering:** no necesarios para logs de Responses. Su adopción requiere una necesidad concreta y soporte del modelo/transporte; no forma parte de esta corrección de alcance.

## Contrato arquitectónico

- **Layer:** Adapter dominante; Application para correlación y validación.
- **Runtime:** adapter web/cloud consumido por desktop; tipos de resultado en shared core.
- **Owner principal:** backend; revisión architecture-first del contrato.
- **Frontend:** estado y copia del identificador de soporte, sesión en memoria.
- **Database:** sin cambios ni nuevas tablas.
- **Contracts touched:** `AIService`, resultado/usage del Workspace Agent y receipt AI en memoria. El receipt de tools aprobadas conserva su significado y se correlaciona, no se sustituye.
- **Allowed dependencies:** UI → servicios de aplicación → `AIService` → adapter OpenAI; tools → `DocumentService`/`DocumentCatalog`.
- **Forbidden dependencies:** UI → OpenAI directo; proveedor → filesystem; historial remoto → identidad o contenido canónico.
- **Invariantes:** evidencia acotada, aprobación por mutación, `.md` canónico, guardado `.md` atómico → manifest atómico → SQLite + enqueue → sync cloud. Auth habilita inferencia cloud, no existencia documental local.
- **Required docs:** `odessay-adr-identidad.md`, `odessay-desktop-document-catalog.md`, `odessay-desktop-target-architecture.md` y los contratos de contexto/ejecución/cache de este directorio.

ODE-509/510/511 son los owners del cambio semántico: ODE-509 produce el veredicto de relaciones, ODE-510 gobierna la cola de contradicciones y ODE-511 sintetiza un documento nuevo con revisión y aprobación explícitas. Activar almacenamiento no cambia el resultado del matcher ni sustituye la validación de evidencia. La aceptación semántica usa OpenAI con el modelo configurado, evidencia y pruebas de outcome.
