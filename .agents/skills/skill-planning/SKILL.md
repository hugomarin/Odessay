---
name: skill-planning
description: "Convierte una unidad del roadmap en un Issue Brief ejecutable: verifica la definición, delimita contratos y dependencias, y fija criterios de aceptación y evidencia antes de BUILD."
---

# Planning

## 1. Objetivo

Planning convierte una intención de producto en una unidad de trabajo que otra persona o agente puede ejecutar y verificar. Contrasta la definición con las fuentes vigentes, identifica consumidores y dependencias, y expresa el comportamiento esperado, sus fallos y la evidencia de entrega.

Pregunta guía: **¿Qué debe cambiar, bajo qué contrato y cómo sabremos que quedó bien?**

## 2. Ámbito y activación

Aplicar al definir o endurecer un issue a partir de un roadmap, una fase o un hallazgo. Si la tarea consiste en evaluar la calidad del conjunto de issues y su cobertura, usar Audit Planning sobre los briefs ya formulados.

El alcance de la fase y la topología entre issues provienen del roadmap y del rol de planificación del proyecto. Este skill hace ejecutable cada unidad.

## 3. Entradas y fuentes de autoridad

Reunir la intención del producto, roadmap y criterios de salida, contrato vigente, comportamiento observado, consumidores, dependencias y validación disponible. Consultar la jerarquía documental que declara el repo. Una spec aceptada define el resultado esperado; el código y las pruebas muestran el estado actual. Verificar hechos críticos antes de citarlos como premisas del brief.

Cargar las guías de arquitectura, rendimiento, dominio o experiencia cuando el cambio active sus decisiones. El proyecto aporta sus fuentes concretas, su schema de issue y el mecanismo donde se persiste.

## 4. Método y criterios

1. Formular el resultado observable y la responsabilidad que cambia.
2. Contrastar la definición con producto, contratos, código y trabajo ya planificado. Registrar las contradicciones con su fuente y efecto antes de basar el brief en ellas.
3. Identificar owner, consumidores, interfaces y dependencias. Dividir el trabajo si dos resultados independientes requieren owners, gates o secuencias distintos.
4. Escribir requisitos verificables: entrada, comportamiento, resultado y límites. Incluir estados de error, interrupción, retry o degradación cuando el flujo los tenga.
5. Declarar los contratos de arquitectura, costo al crecer y experiencia que el cambio activa. Pedir a los skills de dominio pertinentes una revisión de las decisiones que les pertenecen.
6. Elegir evidencia proporcional: qué prueba, inspección o recorrido podría falsificar cada requisito material y en qué entorno.
7. Expresar la aceptación del resultado respecto a la intención del dueño, además de la ejecución técnica del brief.

La estructura exacta del tracker se toma de la especialidad del proyecto; el método conserva estas preguntas aunque cambie la herramienta.

## 5. Resultado y evidencia

Entregar un Issue Brief con contexto y objetivo, responsabilidad y owner, dependencias y consumidores, requisitos, failure modes, contratos aplicables, fuentes consultadas, criterios de aceptación y validación. Hacer explícito cualquier handoff humano y la decisión que requiere.

Cuando el workflow lo pida, añadir una traza de definición: fuentes contrastadas, skills de dominio consultados, objeciones resueltas, auditoría realizada y artefactos creados. Usar el schema local para nombres y campos obligatorios.

## 6. Manejo de fallos e incertidumbre

Una premisa documental contradicha por el código o por una decisión aceptada se registra como brecha de contexto, con fuentes y conducta en disputa. Si la brecha cambia el objetivo, owner o contrato del issue, resolverla antes de declararlo listo para BUILD. La ausencia de una prueba no inventa un contrato: se convierte en requisito de validación cuando el comportamiento puede definirse.

Un brief puede ser internamente consistente y aun así describir el resultado equivocado. La verificación de definición y la aceptación del dueño cubren ese riesgo.

## 7. Relaciones y ownership

El rol de planificación diseña la topología y secuencia de la fase. Planning define la calidad de cada brief. Audit Planning comprueba cobertura, solapamientos y dependencias del conjunto. Architecture y los skills de dominio poseen sus contratos; el workflow posee estados, tracker, gates y entrega.

## 8. Recursos asociados

- **Definición y fuentes:** cargar [definition-and-sources.md](specialties/definition-and-sources.md) al preparar o revisar un brief de Odessay; usarlo para comprobar premisas, seleccionar fuentes y pedir revisión a los skills del dominio.
- **Schema de salida:** cargar [issue-brief-schema.md](specialties/issue-brief-schema.md) al redactar o validar el Issue Brief y la Execution Trace; aplicar sus campos y criterios de evidencia.
- **Publicación en Linear:** cargar [linear-conventions.md](specialties/linear-conventions.md) al crear o actualizar proyectos e issues mediante `wf-define`; usar su jerarquía, labels y asignación sin cargarlo para una revisión local del brief.
- **Fuentes del repo:** roadmap, DoD, contratos y registro documental nombrados por la especialidad.
- **Mecanismos:** usar checks y validación existentes; sus rutas y umbrales pertenecen al proyecto.
