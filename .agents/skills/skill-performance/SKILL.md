---
name: skill-performance
description: "Diseña cambios para performance sostenible cuando crecen datos, features, componentes, eventos o actividad de runtime. Se usa antes de planear, implementar o revisar cargas, hydration, sync, listeners, servicios compartidos, desktop o trabajo en background."
---

# Skill: Performance Architecture

## Propósito

Este skill evita que una solución correcta hoy se convierta en el problema de velocidad de mañana.

La pregunta principal no es solo “¿cuánto tarda esta ejecución?”, sino:

> ¿La solución tiene una forma de costo sostenible cuando aumentan los documentos, usuarios, componentes, eventos y operaciones?

La medición confirma decisiones arquitectónicas; no sustituye una arquitectura de carga sana.

## Cuándo activarlo

Actívalo antes de planear o revisar cualquier cambio que introduzca o modifique:

- fetches, comandos IPC, queries, hydration o sync;
- listados, catálogos, archivos o documentos;
- componentes montados en rutas críticas;
- listeners, subscriptions, stores o eventos reactivos;
- procesos bulk, importación, migración o watchers;
- servicios compartidos o trabajo en background;
- capabilities desktop, Tauri, filesystem, permisos o bundles de producción;
- rutas, layouts o bootstrap de una superficie existente.

No lo actives para un cambio puramente textual o visual que no cambie carga, ejecución, estado, datos ni runtime.

## Regla de construcción

Una feature no está bien diseñada si funciona con pocos datos pero su costo crece accidentalmente con el volumen.

Antes de implementar, la solución debe declarar:

- unidad de escala (`documentos`, `filas`, `eventos`, `componentes`, `usuarios`);
- camino crítico y qué queda fuera de él;
- consumidores existentes de la misma capacidad;
- forma de carga: snapshot, batch, delta, cache, lazy o bajo demanda;
- forma de actualización: single-flight, coalescing, debounce o suscripción global;
- costo esperado cuando crece `N`;
- runtime afectado y capabilities requeridas;
- evidencia mínima para demostrar que no se introdujo una carga evitable.

## Patrones preferidos

Elegir explícitamente el patrón que corresponda:

- **Manifest o índice resumido:** descubrir elementos sin abrir o consultar cada archivo.
- **Batch:** resolver una operación para muchos elementos en una llamada o transacción.
- **Snapshot + delta:** cargar un estado inicial y después solo cambios.
- **Single-flight:** compartir una operación mientras está en curso.
- **Cache con invalidación:** no repetir trabajo conocido sin una regla de frescura.
- **Owner único:** una sola capa coordina hydration, sync o discovery.
- **Event coalescing:** muchos eventos físicos producen una actualización lógica.
- **Lazy o bajo demanda:** sacar capacidades secundarias del camino crítico.
- **Forma mínima de datos:** listas piden metadata; el detalle pide contenido.
- **Virtualización:** renderizar únicamente el conjunto visible cuando el volumen lo exige.

La elección debe quedar explicada en el brief o en la nota de implementación. No se debe aplicar un patrón por moda si no resuelve el costo dominante.

## Forma de costo y crecimiento

Declarar la forma esperada de cada operación relevante:

```text
Startup: O(1), O(batch) u O(delta)
Detalle: O(1) por elemento solicitado
Actualización bulk: un evento lógico y una recarga coalescida
O(N): permitido solo con justificación y fuera del camino crítico cuando sea posible
```

No se prohíbe todo `O(N)`. Se rechaza el `O(N)` accidental en arranque, navegación o interacción cuando existe una alternativa razonable.

Ejemplos de señales de riesgo:

- una llamada, comando o query por elemento;
- un listener por fila, archivo o componente;
- un `useEffect` de hydration por consumidor;
- una lista que transporta el cuerpo completo de cada documento;
- un evento por write de una operación bulk;
- una feature nueva que duplica una fuente de verdad o un servicio ya existente.

## Revisión de impacto global

El análisis no se limita al diff del issue. Para cada cambio activado, revisar:

1. quién ya ejecuta esta operación;
2. qué superficies consumen el mismo dato o servicio;
3. qué cambia en el arranque y en la navegación completa;
4. qué trabajo se acumula si se combinan varias features;
5. si la capacidad llega a una superficie real o queda aislada en helpers/tests;
6. si el issue debe incluir integración global o dividirse en foundation, consumer y validation.

Un issue puede ser técnicamente pequeño y sistémicamente caro. Si la carga solo aparece al combinar varios issues, el riesgo pertenece al planning y no debe dejarse para el review final.

## Performance Architecture Contract

Para issues activados, el brief o plan debe contener un bloque equivalente a:

```text
Performance Architecture:
  System outcome: <qué cambia globalmente>
  Scale unit: <qué representa N>
  Critical path: <qué debe permanecer ligero>
  Existing consumers: <quién ya hace este trabajo>
  Load strategy: <manifest | batch | snapshot | delta | lazy | on-demand>
  Update strategy: <single-flight | cache | coalescing | global subscription | other>
  Expected cost: <O(1) | O(batch) | O(delta) | O(N) justificado>
  Runtime capabilities: <web | desktop | cloud | none>
  Growth risk: <qué puede degradarse y por qué>
  Evidence: <prueba mínima proporcional al riesgo>
  Rejected approach: <qué solución tentadora se descarta>
```

No exigir este bloque para un cambio fuera del alcance del skill. No aceptar un bloque vacío o genérico para un cambio de bootstrap, datos, runtime o listeners.

## Evidencia proporcional

Cuando el contrato pida evidencia ejecutable, consultar
`references/instruments.md`. Ese inventario define qué instrumento corresponde
al riesgo y evita convertir todos los budgets o traces en requisitos universales.

La evidencia debe seguir el riesgo:

### Nivel 1 — Diseño

Revisión del patrón de carga, ownership, consumidores y forma de costo. Es obligatoria antes de BUILD cuando el cambio afecta un camino crítico.

### Nivel 2 — Escala

Fixture o test con volúmenes representativos, por ejemplo 10, 100 y 1,000 elementos, o con el volumen real esperado del producto. Verificar que no aparecen llamadas, listeners, renders o payloads innecesarios por elemento.

### Nivel 3 — Runtime

Trace, waterfall, memoria o interacción cuando el cambio modifica bootstrap, navegación, sync, hydration o el hot path del editor.

### Nivel 4 — Bundle desktop

Si toca Tauri o una capability nativa, validar el bundle instalado. `tauri dev` y mocks del navegador no prueban entitlements, Hardened Runtime, App Sandbox, filesystem ni permisos del sistema.

Las métricas se eligen por decisión, no por exhaustividad. Las categorías habituales son:

- tiempo hasta vista útil o interacción;
- cantidad y forma de requests/IPC;
- peso transferido;
- fan-out de eventos y renders;
- memoria o trabajo de background cuando sea relevante.

No inventar umbrales por issue si ya existe un instrumento aplicable. Tampoco declarar “performance cubierta” solo porque pasó una métrica que no representa el riesgo del cambio.

## Desktop y capabilities nativas

Cuando el cambio toque Tauri, permisos, filesystem, media capture, IPC, firma o distribución, leer:

```text
.agents/skills/skill-performance/references/desktop-runtime-evidence.md
```

También cargar el documento de arquitectura o capability que contenga los
hechos concretos del runtime. Este skill define cómo incorporarlos al diseño
de performance y al plan; no inventa entitlements ni permisos.

Si falta el documento que contiene esos hechos, emitir:

```text
Context Gap — Desktop Runtime Capabilities
Classification: incomplete-context
Required action: identificar o completar la fuente de verdad del runtime antes de cerrar el brief
```

No inferir capabilities, entitlements o requisitos de distribución desde memoria, mocks o una implementación aislada.

Reglas:

- no inferir una capability nativa desde el comportamiento del navegador;
- no aceptar mocks como evidencia de que el bundle instalado funciona;
- distinguir `tauri dev`, build local y DMG distribuible;
- identificar qué capability debe estar lista antes de que una feature pueda considerarse integrada;
- conservar las decisiones documentales de filesystem, catálogo y sandbox definidas por los ADR/specs de arquitectura.

El frontend puede mostrar estado, error y retry. La disponibilidad nativa pertenece al adapter y al contrato de distribución.

## Resultado esperado por modo

### En planning

Entregar el `Performance Architecture Contract`, el impacto global, los consumidores y la dependencia correcta. Si falta información para decidir la forma de carga, marcar un `Context Gap` antes de crear el issue.

### En implementación

Comprobar que la implementación conserva el patrón elegido y que no introduce una segunda hydration, listener, query o fuente de verdad sin justificación.

### En review

Revisar la forma de crecimiento y el sistema completo, no solo el archivo modificado. Un test unitario verde no compensa una arquitectura `O(N)` innecesaria en el arranque.

## Integración con otros skills

- `skill-product-manager`: activa este skill antes de cerrar briefs con carga, datos, runtime o integración global.
- `skill-audit-planning`: usa este skill para detectar acumulación, overlaps y huecos sistémicos entre issues.
- `skill-architecture`: lo consulta para clasificar boundaries, runtime y capabilities.
- `skill-frontend` y `skill-backend`: lo aplican a sus implementaciones sin duplicar sus reglas generales.
- `skill-database`: lo consulta cuando queries, índices, RLS, paginación o migraciones pueden cambiar el fan-out o el costo al crecer.
- `skill-code-review`: verifica que el contrato se cumplió y que la evidencia corresponde al riesgo real.
- `skill-ux-testing`: valida el flujo visible y el tiempo hasta poder operar, sin convertirse en owner de la arquitectura.

## Anti-patrones bloqueantes

Marcar el trabajo como bloqueado o incompleto cuando:

- el issue agrega una operación por elemento en un camino crítico sin justificación;
- no se conocen los consumidores existentes;
- la solución duplica hydration, discovery, listener o fuente de verdad;
- el brief mide solo una dimensión que no representa el riesgo principal;
- una capability desktop se valida únicamente con `tauri dev` o mocks;
- la feature existe en código pero no está integrada en la superficie global que prometía;
- la evidencia se captura sobre otro build, flag, volumen o runtime distinto al que se entrega.

## Límite del skill

Este skill no reemplaza:

- la arquitectura documental y sus ADRs;
- los contratos de dominio;
- los budgets ejecutables;
- el review de seguridad, database o UI;
- la aceptación del resultado por parte del dueño.

Define cómo evitar que las decisiones de esos ámbitos introduzcan carga innecesaria y cuándo deben pedir una decisión arquitectónica antes de BUILD.
