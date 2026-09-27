# Lente de Testing

## Objetivo

Review Testing evalúa la fuerza de la evidencia de pruebas para un cambio de comportamiento. Comprueba que los tests ejercitan el camino de producción, el resultado esperado y los failure modes que pueden invalidarlo.

Pregunta guía: **¿Qué prueba falsificaría el fallo real que este cambio puede introducir?**

## Ámbito y activación

Activar cuando el diff añade o modifica comportamiento observable, especialmente operaciones asíncronas, persistencia, apertura, sync o estado transicional. Seleccionar el nivel de prueba según el failure mode; el tamaño o la importancia del feature no implican por sí solos una prueba E2E.

## Entradas y fuentes de autoridad

Leer el diff, las pruebas existentes, los callers y el contrato de aceptación del cambio. Cargar la estrategia de testing y los criterios de evidencia que el proyecto declara para la capacidad afectada.

## Método y criterios

1. Identificar el comportamiento nuevo o modificado y una prueba que lo ejercite con input válido.
2. Enumerar fallos relevantes: input inválido, red/timeout, base de datos, auth, colección vacía, límites y operación concurrente.
3. Comprobar estado intermedio cuando el resultado correcto depende de timing, interrupción o identidad de la operación.
4. Elegir el nivel mínimo que puede falsificar el fallo: unit para regla pura, contract/integration para colaboración entre servicios, E2E para un recorrido o integración de navegador que esos niveles no demuestran.
5. Verificar fidelidad al camino de producción: entrada real, transiciones que producen el estado, IDs/selectores existentes y doubles que aceptan las llamadas efectivas.
6. Verificar la semántica de completion: la assertion ocurre después del evento que establece el invariante; el trabajo diferido conserva generación o identidad cuando puede quedar stale.
7. Cuando el diff monta un escenario de prueba de integración o componente, consultar `workflow/testing/integration-harness-catalog.md` para identificar el andamiaje canónico reusable y comprobar que los doubles representan boundaries externos. Una cantidad alta de `vi.mock` invita a inspeccionar qué se dobla y qué afirma demostrar el test; el veredicto depende de esa evidencia.

Una prueba sólida afirma resultados, errores y efectos observables; su nombre identifica el comportamiento y puede ejecutarse de forma independiente. Un mock que evita la transición bajo prueba, un simple render, una assertion de existencia o un sleep temporal aporta evidencia débil para un fallo de comportamiento.

Señales concretas: `expect(x).toBeDefined()` o una prueba que solo verifica que no se lanza error; `setTimeout`/`sleep` en vez de `waitFor`; mount sin interacción del usuario; doubles que aceptan solo las llamadas del happy path mientras producción usa otra forma; estado terminal sembrado a mano cuando las transiciones que lo producen son parte de la capacidad bajo prueba. Una subida de cobertura exige evidencia del camino de producción y completion, según el contrato local.

## Resultado y evidencia

Emitir findings en el formato de review local. Nombrar el failure mode no demostrado, la prueba actual, el punto donde deja de representar producción y el nivel mínimo de evidencia que cerraría el hueco.

## Manejo de fallos e incertidumbre

Registrar la ausencia de prueba como gap proporcional al riesgo y al contrato del cambio. Cuando una prueba depende de un entorno no disponible durante review, inspeccionar su diseño y reportar la limitación de ejecución sin atribuirle un resultado. Separar falta de cobertura de un bug de producto observado.

## Relaciones y ownership

Esta lente posee los criterios técnicos de testing en review. Review Correctness describe el fallo funcional; el orquestador fusiona un hallazgo cuando ambos señalan el mismo camino. Un especialista de testing puede ejecutar esta lente y adaptar su formato de respuesta; el criterio permanece aquí.

## Recursos asociados

- **Fuentes locales:** estrategia de testing, mapa de capacidades y contrato de pruebas del proyecto cuando el diff los active; `workflow/testing/integration-harness-catalog.md` cuando el diff monta o cambia andamiaje de integración o componente.
- **Mecanismos:** runner unit/integration/E2E y checks de cobertura existentes, seleccionados por el fallo a demostrar.

Un proyecto puede ofrecer un especialista de ejecución sin duplicar esta rúbrica.
