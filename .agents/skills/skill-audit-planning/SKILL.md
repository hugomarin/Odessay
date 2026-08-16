---
name: skill-audit-planning
description: "Audit de planeación para Odessay: revisa roadmap, DoD, issue briefs, dependencias, overlaps, huecos y contratos faltantes antes de BUILD. Usar cuando se audite la calidad de una fase o de issues definidos."
---

# Skill: Audit Planning

Usa este skill cuando la tarea no sea producir el plan, sino **revisar la calidad del plan**.

Este skill aplica a:

- `wf-audit`
- auto-audit posterior a `wf-define`
- revisión de una fase antes de crear issues en Linear
- revisión de briefs ya creados para detectar overlaps, huecos o secuencia deficiente

No reemplaza:

- `skill-product-manager` — producir roadmap/briefs/issues
- `skill-architecture` — clasificar layer/runtime/owner y boundaries

Este skill responde otra pregunta:

> ¿El plan quedó realmente ejecutable, completo y bien secuenciado?

---

## Qué audita

El audit de planning debe revisar, como mínimo:

- cobertura del DoD
- consistencia con el roadmap
- claridad de hitos de fase
- gaps de alcance
- solapamientos entre issues
- dependencias mal secuenciadas
- contratos faltantes
- ownership ambiguo
- riesgo de scope inflado o issue demasiado grande

---

## Contexto mínimo a cargar

1. `workflow/define/roadmap.md`
2. `workflow/define/dod-[fase].md`
3. `workflow/status.json` (fase activa; para entregas usar `npm run ops:ledger -- built --phase "Fase N" --brief`)
4. `.agents/skills/skill-product-manager/SKILL.md`
5. Si la fase toca desktop, multi-runtime, shared core, save path, sync, parser/serializer o services:
   - `.agents/skills/skill-architecture/SKILL.md`
   - la secuencia `odessay-desktop-*`

Si ya existen issues o briefs en Linear, cargar también:

6. los issues de la fase
7. sus Issue Briefs completos

---

## Preguntas obligatorias del audit

### 1. Cobertura del DoD

- ¿Cada bloque del DoD tiene al menos un issue o un conjunto de issues que lo cierre?
- ¿Existe algún criterio de salida sin owner claro?
- ¿Hay issues que no contribuyen realmente al cierre del DoD?

### 2. Calidad del roadmap

- ¿La fase está definida como cambio de estado del sistema y no solo como lista de actividades?
- ¿El hito de fase es reconocible y verificable?
- ¿Los “temas que no entran” están respetados por los issues?

### 3. Solapamientos

- ¿Dos o más issues tocan el mismo problema sin una frontera clara?
- ¿Hay duplicación de ownership entre frontend/backend/architecture?
- ¿El plan podría producir trabajo paralelo conflictivo?

### 4. Huecos

- ¿Falta algún issue estructural para que BUILD pueda ejecutar sin improvisar?
- ¿Falta alguna validación, harness, contract o migration step?
- ¿Hay promesas de fase que nadie está implementando?

### 5. Secuencia y dependencias

- ¿El orden de ejecución es defendible?
- ¿Hay issues bloqueados por otros que todavía no existen?
- ¿Se intenta implementar una superficie antes de fijar el contrato que la sostiene?

### 6. Calidad de briefs

Por cada issue:

- ¿El problema está bien explicado?
- ¿Las dependencias están claras?
- ¿Los `Files affected` son honestos?
- ¿Los `Requirements` son verificables?
- ¿El `Proof of Work`/acceptance está alineado con el DoD?
- ¿Incluye `Architecture Contract` cuando aplica?
- ¿Incluye `Presentation Contract` cuando aplica?

---

## Criterios de rechazo del plan

Un audit debe marcar `FAIL` si ocurre cualquiera de estas condiciones:

- el DoD no está cubierto de forma suficiente
- existe overlap grave entre issues sin ownership claro
- la fase promete un hito que los issues no pueden cerrar
- un issue arquitectónico no tiene `Architecture Contract`
- la secuencia obliga a BUILD a improvisar contracts o boundaries
- hay huecos críticos que moverían decisiones estructurales a mitad de BUILD

---

## Formato de salida recomendado

El resultado del audit debe separarse en cuatro capas:

Y debe incluir además una `Execution Trace` breve para que quede claro:

- qué rol condujo el audit
- qué skills fueron cargados
- si hubo consulta a especialistas
- qué artefactos se auditaron
- qué evidencias quedaron fuera

### `GateResult`

- `PASS`
- `PASS WITH GAPS`
- `FAIL`

### `Coverage`

- qué partes del DoD están bien cubiertas
- qué partes están cubiertas débilmente
- qué partes no están cubiertas

### `Findings`

Lista priorizada de hallazgos:

- overlap
- hueco
- dependencia faltante
- contract faltante
- brief ambiguo
- secuencia defectuosa

### `Recommended Fixes`

Acciones concretas y mínimas:

- dividir issue
- fusionar issues
- agregar issue faltante
- mover issue de fase
- endurecer brief
- agregar contrato o referencia documental

---

## Regla de severidad

- `P0`: el plan no puede pasar a BUILD
- `P1`: el plan podría arrancar, pero con alto riesgo de rework o improvisación
- `P2`: la calidad del brief o de la secuencia debe mejorar, aunque no bloquea por sí solo

---

## Señales de buen audit

- reduce incertidumbre
- hace visible el critical path real
- detecta huecos antes de crear trabajo
- evita que BUILD se convierta en discovery tardío

## Señales de mal audit

- reescribe todo el roadmap sin necesidad
- critica en abstracto sin proponer fixes mínimos
- confunde review de planificación con review de código
- abre alcance nuevo en lugar de verificar el alcance ya definido
