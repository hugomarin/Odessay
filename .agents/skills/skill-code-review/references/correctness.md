# Lente de Correctness

## Objetivo

Review Correctness identifica un camino de ejecución concreto por el que el cambio produce un resultado incorrecto. Reconstruye el estado inicial, las transiciones y lo que observan los consumidores para formular findings verificables.

Pregunta guía: **¿Qué comportamiento real puede fallar por este diff y en qué secuencia ocurre?**

## Ámbito y activación

Activar cuando el diff modifica transiciones críticas, estado asíncrono, updates optimistas, filtros o validaciones con varios entrypoints, o procesamiento de datos externos. El orquestador de review selecciona esta lente a partir del comportamiento cambiado.

## Entradas y fuentes de autoridad

Leer el diff, sus callers y consumers, los contratos de estado y las pruebas actuales. Cargar las reglas del dominio y los invariantes de experiencia que el proyecto vincule a la superficie afectada. El código muestra el camino ejecutable; el contrato local fija el resultado esperado.

## Método y criterios

1. Identificar inputs y estado antes del cambio.
2. Trazar éxito, falla, interrupción, timeout y retry; comprobar la salida de cada estado intermedio.
3. Verificar qué consumer recibe el resultado y si observa una transición consistente.
4. Identificar quién decide cada transición. Dos mecanismos que pueden decidir el mismo resultado requieren una regla de coordinación explícita.
5. Seguir todas las entradas de un dato hasta la regla de admisión, filtro o validación.
6. Comparar el camino con un sibling existente cuando aclare el contrato.

Buscar en especial: transiciones co-owned; contenido y metadata de entidades distintas visibles al mismo tiempo; identidad o persistencia creada en un handler caliente; estados stale sin salida; filtro aplicado en una sola entrada; update optimista sin rollback; colección externa descartada entera por un item inválido; matching duplicado sin prueba de paridad; excepción absorbida mientras el caller asume éxito.

Señales concretas: router, estado local, Zustand y refs deciden a la vez una transición o conservan copias del mismo dato; `crypto.randomUUID()` o `localDB.save()` corre en un handler síncrono de `input`, `paste` o `click`; el `catch` de un update optimista solo registra el error; `.catch([])` o un parser all-or-nothing descarta un lote de LLM por un item inválido. Cuando el comportamiento correcto depende del estado intermedio, comprobarlo durante una interrupción o concurrencia, además del estado final.

Una interacción también puede ser incorrecta por su latencia o bloqueo cuando la inmediatez forma parte del contrato del producto. Cargar el criterio de performance local para ese caso y describir el camino que causa la regresión.

## Resultado y evidencia

Emitir findings en el formato del review local. Cada uno nombra el input, la secuencia, el resultado observado o inferido del código, el resultado esperado y una corrección viable. Un path de ejecución reproducible sostiene la severidad.

## Manejo de fallos e incertidumbre

Cuando el diff no permite demostrar un fallo, seguir callers o pruebas hasta resolverlo. Si una decisión de producto falta, señalar la fuente ausente y su efecto; no presentar una posibilidad abstracta como bug confirmado. La ausencia de pruebas sobre estados intermedios se coordina con Review Testing cuando el riesgo depende de esa transición.

## Relaciones y ownership

Esta lente posee el análisis de corrección del comportamiento. Review Testing evalúa si las pruebas lo demuestran; Review Architecture evalúa ownership y boundaries; Performance aporta criterios de costo al crecer. El orquestador consolida hallazgos compartidos en un solo finding.

## Recursos asociados

- **Conocimiento local:** cargar invariantes de producto y contratos de AI, navegación, persistencia o experiencia según el cambio.
- **Mecanismos:** usar tests focalizados y trazas cuando prueben el camino de fallo; los checks estáticos complementan el análisis de transiciones.

No requiere scripts propios.
