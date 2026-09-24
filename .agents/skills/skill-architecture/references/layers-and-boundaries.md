# Criterios de capas y boundaries

Esta referencia amplía el método de Architecture para clasificar una responsabilidad. Las etiquetas concretas, contratos y fuentes de verdad las aporta cada proyecto.

## Clasificar por el trabajo que realiza la pieza

| Capa | Función | Entradas y salidas típicas | Evidencia útil |
| --- | --- | --- | --- |
| `UI` | Presenta estado y recoge acciones de la persona. | Props/estado de vista → eventos, controles y representación. | Render, interacción, accesibilidad y consumidores del componente. |
| `Application` | Coordina los pasos de un caso de uso y sus resultados. | Intención del usuario + puertos → resultado de operación y transiciones. | Orden de llamadas, recuperación, idempotencia y tests del flujo. |
| `Domain` | Define significado, reglas e invariantes del producto. | Entidades/valores → decisiones y transformaciones con semántica estable. | Contratos aceptados y tests de reglas que deben valer en varios runtimes. |
| `Adapter` | Conecta un puerto o contrato con infraestructura concreta. | Operación normalizada → HTTP, filesystem, base de datos, APIs nativas u otro sistema. | Dependencias externas, configuración, traducción de errores y contract tests. |

Una operación puede atravesar varias capas. Clasificar cada responsabilidad relevante por separado permite que un componente presente el resultado, un caso de uso coordine pasos y un adapter resuelva la infraestructura sin que ninguno absorba el trabajo de los otros.

### Preguntas para ubicarla

1. **UI:** ¿La decisión cambia solo presentación, interacción local o estado visual?
2. **Application:** Cuando sucede la acción, ¿qué secuencia y condiciones de éxito/fallo coordina el sistema?
3. **Domain:** ¿Qué regla debe conservar su significado aunque cambie el runtime o la interfaz?
4. **Adapter:** ¿Qué dependencia concreta traduce un contrato a un entorno externo?

Si una pieza contiene varias respuestas, dividir primero la responsabilidad en partes. El tamaño del archivo y su cercanía a la pantalla son evidencia de ubicación actual, no criterio suficiente de ownership.

## Declarar el boundary

Para cada parte, registrar:

- **Input:** dato o intención que recibe, con identidad y validación necesarias.
- **Output:** resultado, estado o error que promete al consumidor.
- **Dependencias:** contratos que usa y sistemas externos que puede tocar en ese runtime.
- **Invariantes:** hechos que debe preservar antes, durante y después de la operación.
- **Owner:** módulo, servicio o equipo que puede cambiar su contrato; si falta una decisión aceptada, declarar esa necesidad.

Una UI consume una capacidad de aplicación o un contrato y muestra su resultado. Un adapter implementa la capacidad usando el entorno disponible. El dominio conserva las reglas que deben viajar entre runtimes. Si un servicio cambia de operación o envelope, fijar primero el contrato y después adaptar cada runtime afectado.

## Declarar el runtime

El runtime **actual** explica dónde se ejecuta hoy la implementación. El runtime **objetivo** explica dónde debe funcionar tras el cambio. Especificar ambos evita tratar una dependencia del entorno actual como parte del núcleo compartido.

Un contrato compartido puede definir tipos y comportamiento mientras sus adapters usan HTTP, almacenamiento local o APIs nativas distintos. El código compartido debe poder depender de ese contrato y de lógica pura; las decisiones de transporte, credenciales, rutas físicas y persistencia pertenecen al adapter correspondiente.

En un endpoint web, separar la traducción HTTP de las reglas del caso de uso. En desktop, separar la interacción con filesystem o APIs nativas de la semántica del documento o entidad. Una capacidad cloud puede coordinar estado remoto sin convertirse en autoridad sobre el estado local, salvo que el contrato del proyecto lo declare.

## Ejemplo de clasificación

Ante “subir una imagen y mostrar un error recuperable”, la UI recoge el archivo y presenta el mensaje; la aplicación decide los pasos de la operación cuando hay coordinación; el contrato describe inputs, resultado y errores; los adapters realizan la subida o lectura según runtime. El proyecto determina qué sistema guarda el asset y cuándo una copia remota es necesaria.

La clasificación termina con una superficie de cambio y una lista de fuentes consultadas. Architecture Recon comprueba después qué módulos concretos materializan estas responsabilidades, cuáles son consumidores y qué tests muestran su comportamiento actual.
