---
name: architecture-recon
description: Investiga en el código el owner actual, las APIs reutilizables, los consumidores y las pruebas de una responsabilidad antes de implementar un cambio no trivial que la crea, extiende o mueve.
---

# Architecture Recon

## 1. Objetivo

Architecture Recon investiga dónde vive hoy una responsabilidad en el código y qué puede reutilizarse. Identifica al owner actual, las APIs disponibles, los módulos relacionados, sus consumidores y sus pruebas. Confronta esa evidencia con el contrato esperado para delimitar el cambio o señalar una ambigüedad antes de implementar.

Pregunta guía: **¿Dónde vive hoy esta responsabilidad y qué podemos reutilizar?**

## 2. Ámbito y activación

Activar antes de implementar un cambio que cree, extienda o mueva una responsabilidad no trivial: servicio, store, hook, adapter, serializer, state machine, persistencia o contrato compartido. También aplica cuando el cambio entra en un módulo de composición, toca varios consumidores o trae un contrato de arquitectura que debe confrontarse con el código.

Un ajuste local de copy, estilo o una línea que conserva claramente el mismo owner puede seguir el flujo normal del proyecto.

## 3. Entradas y fuentes de autoridad

Reunir la intención del cambio, su superficie prevista, el código del repositorio y el contrato esperado cuando exista. Cargar las instrucciones del repo y del subtree afectado, además de las fuentes normativas que el proyecto vincula a ese contrato. Seguir la política local de descubrimiento documental; inspeccionar código relevante es parte de esta investigación.

El contrato y las decisiones aceptadas indican qué debe ser verdad. El código demuestra cómo funciona hoy. Si difieren, registrar la divergencia y su clasificación según las reglas del proyecto antes de proponer una dirección de implementación.

## 4. Método y criterios

1. Formular la responsabilidad semántica y buscarla por concepto, símbolos y operaciones, además de por ruta.
2. Localizar la implementación y el owner observados, junto con una API que ya resuelva el cambio. Confrontarlos con el owner esperado antes de llamarlos canónicos. Distinguir **reutilizar una API existente** de **seguir un sibling como patrón de forma** cuando realmente se necesita una pieza nueva.
3. Clasificar módulos relacionados como `canonical`, `consumer`, `legacy`, `duplicate` o `unrelated`, con evidencia para cada clasificación relevante.
4. Trazar dependencias upstream, consumidores downstream, pruebas que ejercitan el comportamiento actual y precondiciones de validación declaradas para ese cambio. Registrar la ausencia de pruebas como dato para la implementación.
5. Revisar instrucciones scoped y módulos de composición que el cambio tocaría. Distinguir el cableado en esos módulos de la responsabilidad que pertenece a otro owner.
6. Confrontar owner y comportamiento observados con el contrato esperado. Delimitar la superficie mínima coherente del cambio y señalar si requiere una abstracción nueva.

Acotar la búsqueda a la responsabilidad y sus consumidores reales; ampliar el alcance solo cuando una dependencia encontrada lo justifique.

## 5. Resultado y evidencia

Entregar antes de implementar un Recon breve, con rutas o símbolos comprobables:

```text
Architecture Recon
- Change intent / responsibility:
- Domain:
- Canonical owner (según contrato, o candidatos si falta decisión):
- Observed implementation / owner (canonical, legacy o candidatos):
- Reusable API / abstraction:
- Canonical reference / sibling (si hace falta crear algo):
- Relevant siblings (clasificados):
- Upstream dependencies / contracts:
- Consumers:
- Contracts touched:
- Hotspots / scoped instructions:
- Canonical tests (o ausencia):
- Validation dependencies (si existen):
- Proposed change surface:
- New abstraction required: yes/no
- Architecture ambiguity: yes/no
```

El Recon completo es contexto de trabajo de la tarea. Su persistencia y la promoción de hallazgos recurrentes siguen el protocolo del proyecto.

## 6. Manejo de fallos e incertidumbre

Cuando dos owners plausibles compiten, un duplicado contradice el contrato o el comportamiento esperado de un consumidor depende de una decisión no documentada, emitir un `Context Gap` con fuentes, conducta observada, ambigüedad y decisión requerida. Seguir la clasificación y el gate de la fuente local aplicable.

La falta de una prueba existente se registra y orienta la validación del cambio. Una decisión ordinaria dentro de un owner ya claro se resuelve durante la implementación.

## 7. Relaciones y ownership

El criterio de arquitectura del proyecto fija el owner y las boundaries **esperadas**; Recon identifica el owner y las dependencias **observadas**. El rol de BUILD usa el Recon para decidir el orden de construcción. Los skills de implementación aportan reglas del dominio una vez localizada la responsabilidad.

El protocolo local gobierna briefs, estados, tracker, persistencia de hallazgos y aprobación. Recon entrega evidencia de código para esas decisiones.

## 8. Recursos asociados

- **Owner esperado y fuentes locales:** al investigar una responsabilidad de Odessay, consultar [ownership-and-sources.md](../skill-architecture/specialties/ownership-and-sources.md) para identificar el contrato, la precedencia documental y los hotspots aplicables; confrontar esa expectativa con el código encontrado. Cargar además el `AGENTS.md` del subtree que el cambio tocaría.
- **Guías tecnológicas:** consultar la guía del runtime o problema cuando el owner encontrado la requiere; comprobar sus supuestos contra la configuración efectiva del repo.
- **Mecanismos:** usar búsquedas, tests o checks de boundaries existentes para verificar hallazgos concretos. El proyecto conserva las rutas operativas y los budgets de esos instrumentos.

Este skill funciona sin scripts ni especialistas propios. Un proyecto puede adjuntarlos cuando aporten evidencia repetible o ejecución especializada.
