# Contrato de auditoría de fases de Odessay

Este recurso conserva fuentes, formatos y escenarios concretos del proyecto. AGENTS.md y los contratos aceptados mantienen la precedencia normativa; el SKILL.md del directorio contiene el método reusable.

## 1. Objetivo

Audit Planning comprueba que una fase y sus issues cubren el resultado prometido y forman un plan ejecutable, con dependencias, contratos y evidencia explícitos.

Cargar este contrato local cuando la tarea revise la calidad de una fase o de sus briefs.

Sus escenarios de aplicación son:

- `wf-audit`
- auto-audit posterior a `wf-define`
- revisión de una fase antes de crear issues en Linear
- revisión de briefs ya creados para detectar overlaps, huecos o secuencia deficiente

No reemplaza:

- `skill-planning` — producir roadmap/briefs/issues
- `skill-architecture` — clasificar layer/runtime/owner y boundaries

La auditoría responde esta pregunta:

> ¿El plan quedó realmente ejecutable, completo y bien secuenciado?

## 2. Ámbito y activación

### Qué audita

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

## 3. Entradas y fuentes de autoridad

### Contexto mínimo a cargar

1. `workflow/define/roadmap.md`
2. `workflow/define/dod-[fase].md`
3. `workflow/status.json` (fase activa; para entregas usar `npm run ops:ledger -- built --phase "Fase N" --brief`)
4. `.agents/skills/skill-planning/SKILL.md`
5. Si algún issue de la fase cambia ownership, contrato, fuente de verdad, runtime o boundary (por ejemplo en desktop, shared core, save path, sync, parser/serializer o servicios):
   - `.agents/skills/skill-architecture/SKILL.md`
   - las fuentes normativas y de apoyo seleccionadas por contrato en `AGENTS.md` y `.agents/skills/skill-architecture/specialties/ownership-and-sources.md`
6. Si los issues introducen datos, fetches, hydration, listeners, procesos bulk, trabajo background o cambios de carga:
   - `.agents/skills/skill-performance/SKILL.md`

Si ya existen issues o briefs en Linear, cargar también:

7. los issues de la fase
8. sus Issue Briefs completos

---

## 4. Método y criterios

### Preguntas obligatorias del audit

#### 1. Cobertura del DoD

- ¿Cada bloque del DoD tiene al menos un issue o un conjunto de issues que lo cierre?
- ¿Existe algún criterio de salida sin owner claro?
- ¿Hay issues que no contribuyen realmente al cierre del DoD?

#### 2. Calidad del roadmap

- ¿La fase está definida como cambio de estado del sistema y no solo como lista de actividades?
- ¿El hito de fase es reconocible y verificable?
- ¿Los “temas que no entran” están respetados por los issues?

#### 3. Solapamientos

- ¿Dos o más issues tocan el mismo problema sin una frontera clara?
- ¿Hay duplicación de ownership entre frontend/backend/architecture?
- ¿El plan podría producir trabajo paralelo conflictivo?

#### 4. Huecos

- ¿Falta algún issue estructural para que BUILD pueda ejecutar sin improvisar?
- ¿Falta alguna validación, harness, contract o migration step?
- ¿Hay promesas de fase que nadie está implementando?

#### 5. Secuencia y dependencias

- ¿El orden de ejecución es defendible?
- ¿Hay issues bloqueados por otros que todavía no existen?
- ¿Se intenta implementar una superficie antes de fijar el contrato que la sostiene?

#### 6. Calidad de briefs

Por cada issue:

- ¿El problema está bien explicado?
- ¿Las dependencias están claras?
- ¿Los `Files affected` son honestos?
- ¿Los `Requirements` son verificables?
- ¿El `Proof of Work`/acceptance está alineado con el DoD?
- ¿Incluye `Architecture Contract` cuando aplica?
- ¿Incluye `Presentation Contract` cuando aplica?
- ¿Incluye `Performance Architecture Contract` cuando el issue puede alterar carga o costo de crecimiento?

#### 7. Acumulación sistémica

- ¿El issue agrega una operación que ya existe en otro consumidor?
- ¿El costo crece por documento, fila, componente o evento sin una razón explícita?
- ¿La fase está agregando funcionalidades que individualmente parecen pequeñas pero juntas cargan el mismo camino crítico?
- ¿El issue llega a una superficie global o queda aislado en helpers, servicios o tests?
- ¿Existe un owner único para hydration, discovery, sync o suscripciones?
- ¿La estrategia de batch, snapshot, delta, cache o coalescing está definida antes de BUILD?

---

## 5. Resultado y evidencia

### Formato de salida recomendado

El resultado del audit debe separarse en cuatro capas:

Y debe incluir además una `Execution Trace` breve para que quede claro:

- qué rol condujo el audit
- qué skills fueron cargados
- si hubo consulta a especialistas
- qué artefactos se auditaron
- qué evidencias quedaron fuera

#### `GateResult`

- `PASS`
- `PASS WITH GAPS`
- `FAIL`

#### `Coverage`

- qué partes del DoD están bien cubiertas
- qué partes están cubiertas débilmente
- qué partes no están cubiertas

#### `Findings`

Lista priorizada de hallazgos:

- overlap
- hueco
- dependencia faltante
- contract faltante
- brief ambiguo
- secuencia defectuosa

#### `Recommended Fixes`

Acciones concretas y mínimas:

- dividir issue
- fusionar issues
- agregar issue faltante
- mover issue de fase
- endurecer brief
- agregar contrato o referencia documental

---

### Señales de buen audit

- reduce incertidumbre
- hace visible el critical path real
- detecta huecos antes de crear trabajo
- evita que BUILD se convierta en discovery tardío

## 6. Manejo de fallos e incertidumbre

### Criterios de rechazo del plan

Un audit debe marcar `FAIL` si ocurre cualquiera de estas condiciones:

- el DoD no está cubierto de forma suficiente
- existe overlap grave entre issues sin ownership claro
- la fase promete un hito que los issues no pueden cerrar
- un issue arquitectónico no tiene `Architecture Contract`
- la secuencia obliga a BUILD a improvisar contracts o boundaries
- hay huecos críticos que moverían decisiones estructurales a mitad de BUILD
- un issue activado por performance no tiene `Performance Architecture Contract` o deja sin resolver su impacto global

---

### Regla de severidad

- `P0`: el plan no puede pasar a BUILD
- `P1`: el plan podría arrancar, pero con alto riesgo de rework o improvisación
- `P2`: la calidad del brief o de la secuencia debe mejorar, aunque no bloquea por sí solo

---

### Señales de mal audit

- reescribe todo el roadmap sin necesidad
- critica en abstracto sin proponer fixes mínimos
- confunde review de planificación con review de código
- abre alcance nuevo en lugar de verificar el alcance ya definido

## 7. Relaciones y ownership

Planning define cada brief; Audit Planning revisa cobertura, solapamientos y secuencia del conjunto. Architecture y Performance aportan sus contratos cuando el alcance los activa; el workflow posee estados y entrega.

## 8. Recursos asociados

Las fuentes locales y el formato operativo se consultan en Entradas y Resultado. Este recurso no requiere scripts propios.
