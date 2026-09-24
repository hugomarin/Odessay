---
name: skill-architecture
description: Clasifica una decisión de cambio por responsabilidad, capa, runtime y owner; fija los límites y contratos esperados antes de planear o implementar trabajo que cruza esas fronteras.
---

# Architecture

## 1. Objetivo

Architecture establece dónde debe vivir cada responsabilidad de un cambio y qué contratos deben preservarse. Identifica la capa, los runtimes, el owner esperado, las dependencias permitidas y los invariantes aplicables. Produce una clasificación que planning, implementación y review pueden comprobar frente al código.

Pregunta guía: **¿Quién debe poseer esta responsabilidad y qué límites debe respetar?**

## 2. Ámbito y activación

Activar cuando el cambio modifica un contrato compartido, cruza capas o runtimes, altera una fuente de verdad, incorpora un adapter, mueve ownership o cambia una operación con dependencias externas. Aplicar también si la propuesta de implementación deja abiertas dos ubicaciones plausibles para la misma responsabilidad.

Un cambio local de presentación o copy con owner y boundary claros puede usar las reglas normales del proyecto. La activación responde a la decisión arquitectónica que exige el cambio, no al tamaño del diff ni al nombre de una carpeta.

## 3. Entradas y fuentes de autoridad

Reunir la intención del cambio, los comportamientos afectados, los runtimes actuales y objetivo, las instrucciones del repo y los contratos locales pertinentes. Leer las fuentes en el orden de precedencia que declare el proyecto. Un ADR o contrato aceptado define el estado esperado; el código describe el estado observado y ayuda a localizar la brecha.

El proyecto proporciona sus etiquetas de capas, runtimes y ownership, sus fuentes de verdad y las condiciones para cargar cada documento. Una taxonomía ausente se formula en términos descriptivos con las fuentes disponibles y se señala si bloquea una decisión real.

## 4. Método y criterios

1. Formular la responsabilidad semántica y separar sus partes cuando UI, coordinación, reglas de dominio e infraestructura realicen trabajos distintos.
2. Identificar quién tiene autoridad sobre cada dato y operación, incluidos los estados actuales y objetivo. Cargar las decisiones locales que fijan esa autoridad.
3. Clasificar cada parte en tres ejes independientes: `Layer` (tipo de trabajo), `Runtime scope` (dónde corre) y `Owner` (quién decide o mantiene su contrato). Usar las etiquetas locales cuando existan.
4. Declarar el boundary: entradas, salidas, dependencias permitidas y dependencias que romperían el contrato. Distinguir un contrato compartido de sus adapters por runtime.
5. Identificar invariantes y consumidores afectados; comprobar si la intención requiere cambiar primero un contrato o si cabe dentro del ya aceptado.
6. Proponer la ubicación y el alcance arquitectónico mínimo que conserva esas relaciones. Encargar a Recon verificar owners, APIs y tests observados antes de construir.

Si el cambio altera el costo al crecer, consultar el método de performance que el proyecto haya adoptado y agregar su contrato de evidencia.

Consultar [criterios de capas y boundaries](references/layers-and-boundaries.md) cuando la clasificación requiera distinguir UI, coordinación, dominio y adapters o declarar dependencias entre runtimes.

## 5. Resultado y evidencia

Entregar una clasificación breve, con fuentes de autoridad para cada decisión material:

```text
Architectural classification
- Change intent / responsibility:
- Layer: dominante y secundarias, por responsabilidad cuando difieran.
- Runtime scope: actual y objetivo.
- Ownership: owner principal y owners de las partes afectadas.
- Frontend owns / Backend owns / Database owns: partes aplicables.
- Contracts touched:
- Invariants:
- Boundaries: inputs, outputs y dependencias.
- Architectural change surface:
- Needs architectural contract first: yes/no.
- Required docs for the issue / local sources:
- Architecture ambiguity: yes/no.
```

La clasificación describe el contrato esperado. Un Recon posterior agrega rutas, símbolos, consumidores y pruebas de la implementación observada.

## 6. Manejo de fallos e incertidumbre

Cuando falta una decisión que determine el owner, dos fuentes normativas discrepan o un contrato aceptado contradice la implementación, registrar un `Context Gap` con la conducta propuesta, las fuentes y la decisión necesaria. Aplicar la precedencia y el protocolo de escalamiento locales. Una brecha de implementación ya reconocida se clasifica según la política del proyecto y se incorpora al alcance solo si el trabajo actual posee esa migración.

La ausencia de una etiqueta local para una capa no bloquea por sí sola el análisis: describir la responsabilidad y su boundary. Una decisión arquitectónica necesaria y sin fuente sí requiere resolución antes de convertirla en código.

## 7. Relaciones y ownership

Architecture posee la clasificación **esperada** de responsabilidades, contratos y boundaries. Architecture Recon investiga owners, APIs, consumidores y pruebas **observados** en el código. Planning convierte la clasificación en alcance y criterios; implementación trabaja dentro de ella; review comprueba el resultado. El workflow local posee estados, aprobación y seguimiento.

Las fuentes normativas del proyecto conservan la autoridad sobre sus decisiones. Este skill las selecciona y aplica a la tarea; no crea un segundo contrato del proyecto.

## 8. Recursos asociados

- **Contrato local:** al clasificar trabajo de Odessay, consultar [ownership-and-sources.md](specialties/ownership-and-sources.md) para seleccionar las decisiones y fuentes normativas del runtime afectado; usarlo para fijar owner y precedencia antes de proponer ubicación.
- **Referencia metodológica:** cargar [layers-and-boundaries.md](references/layers-and-boundaries.md) cuando varias capas sean plausibles; aplicar sus criterios de trabajo, inputs, outputs y dependencias para distinguir UI, aplicación, dominio y adapters.
- **Guías tecnológicas:** cargar una guía por runtime o clase de problema cuando sus supuestos coincidan con el repo.
- **Mecanismos:** usar checks de boundaries y contract tests existentes para contrastar una clasificación específica. Un check verifica hechos codificables; las decisiones semánticas conservan su fuente normativa.

El método funciona sin scripts propios. Los recursos auxiliares se agregan cuando aportan conocimiento o evidencia que el proyecto necesita de forma recurrente.
