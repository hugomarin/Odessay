# Artifact Studio Quality Harness

**Implementation Specification v2.1** Skills → Agents → `AGENTS.md` → Workflow → CI / GitHub Actions → Remediation

> **Objetivo:** convertir el conocimiento acumulado del repositorio en un sistema que (1) reduzca el espacio de soluciones incorrectas antes de escribir código y (2) remedie de forma priorizada la deuda estructural que ya hace más difícil modificar Artifact Studio. Las reglas maduras deben promoverse desde el juicio del reviewer hacia owners, APIs, tests, architecture checks y CI.

**Baseline observado:** repositorios Artifact Studio y OpenAI Codex revisados el 18 de septiembre de 2026.

*No propone una gran refactorización del producto. Propone primero refactorizar el harness y usar el trabajo normal de features para hacer converger el código mediante ratchets y remediación selectiva.*

## Contenido

 1. Principio operativo y taxonomía del harness
 2. Skills: rediseño completo
 3. Agents: roles de BUILD y REVIEW
 4. `AGENTS.md`: constitución global y reglas locales
 5. Proposed Artifact Studio Quality Architecture
 6. Workflow: cómo cambian `wf-build` y `wf-review`
 7. CI y GitHub Actions: enforcement mecánico
 8. Remediation Plane: corregir deuda existente
 9. Learning loop: convertir findings en memoria estructural
10. Plan de implementación incremental
11. Definition of Done y métricas
12. Apéndice A. Árbol objetivo de archivos
13. Apéndice B. Migración de `skill-code-review`
14. Apéndice C. Gap Matrix: prevención vs remediación

---

## Estado de implementación (actualizado 2026-09-22)

> Este documento se importó al repo el 2026-09-22, después de vivir varias semanas solo en un archivo local fuera de control de versiones — ningún agente ni sesión anterior a esta pudo leerlo directamente. Esta sección es la única parte que no formaba parte del documento original; el resto del archivo (secciones 1-14 y apéndices) se conserva sin editar, como registro histórico de la intención original.

**Resumen:** las Fases 1-5 (sección 10) se ejecutaron casi al pie de la letra. La Fase 6 — Remediation Plane tal como está especificado en la sección 8 (`architecture/remediation.yml`, dispositions FIX NOW/PLANNED/OPPORTUNISTIC/RATCHET) — **nunca se construyó así**. En su lugar, el trabajo divergió hacia un mecanismo distinto y no descrito en este spec: el **Capability Integration Map** (`workflow/quality/capability-integration-map.md`), que clasifica 106 escenarios de producto por cobertura de test real (`NONE`→`INTEGRATION`) y los cierra vía "Critical Proofs" en vez de por disposition de deuda arquitectónica. Ver la nota al inicio de ese documento para el detalle de la relación entre ambos.

| Fase del plan (sección 10) | Qué pedía | Estado real, verificado contra el repo |
|---|---|---|
| 1 — Architecture Recon + Build/Review Agent + split `skill-code-review` | `architecture-recon/SKILL.md`, `build-agent.md`, `review-agent.md`, reducir `skill-code-review` a orquestación | ✅ Hecho — PR [#433](https://github.com/hugomarin/Odessay/pull/433). `skill-code-review/SKILL.md` son 135 líneas hoy (era ~565). `product-manager` se renombró a `planning-agent`, no al nombre que el spec sugería. |
| 2 — `AGENTS.md` local + protección de hotspots | Root corto + `components/editor/AGENTS.md` + `src-tauri/AGENTS.md` | ✅ Hecho — root son 89 líneas de reglas universales (más un guardrail de arquitectura documental desktop, preexistente al harness); existen exactamente `components/editor/AGENTS.md` y `src-tauri/AGENTS.md`, ningún otro local. |
| 3 — Reestructurar GitHub Actions | `blocking-ci/quality/repo-checks/scoped-ci/process-checks/release-desktop.yml` | ✅ Hecho — PR [#434](https://github.com/hugomarin/Odessay/pull/434). Los 6 archivos existen en `.github/workflows/` con esos nombres exactos. |
| 4 — Architecture ratchets | `tests/architecture/*` + `architecture/boundaries.yml` + baseline | ✅ Hecho — PR [#435](https://github.com/hugomarin/Odessay/pull/435). 5 archivos en `tests/architecture/` (2 más de los que este spec nombraba); `architecture/boundaries.yml` + `boundaries.baseline.json` existen, ratchet monotónico en ambas direcciones (más estricto que lo descrito aquí). |
| 5 — Scoped CI + separación de performance + promotion loop | Detectar changed areas, mover performance fuera del delivery gate | ✅ Hecho — PR [#436](https://github.com/hugomarin/Odessay/pull/436). |
| 6 — Current Debt Triage + staged remediation | `architecture/remediation.yml`, dispositions explícitas, primeros candidatos (editor direct correction persistence, Workspace duplicated document-state) | ❌ **No implementado tal cual.** No existen `architecture/remediation.yml`, `owners.yml`, `hotspots.yml` ni `references.yml` — solo `boundaries.yml` de la Fase 4. El PR que iba a ser esto (#437) se convirtió en el Capability Integration Map en su lugar. Los candidatos de deuda que este spec nombraba (editor direct correction persistence, Workspace duplicated document-state projection) siguen sin disposition formal en ningún lado. |

**Otros gaps puntuales, menores:**
- Sección 2.6 proponía `review-runtime-boundaries` y `review-security` como skills separadas — nunca se crearon así; ese juicio quedó repartido entre `skill-code-review`, `review-architecture` y otras skills existentes (`skill-database`, `skill-backend`).
- El catálogo de skills real (`.agents/skills/`) creció mucho más allá del alcance de este spec (`skill-planning`, `skill-backend`, `skill-database`, `skill-design`, `skill-design-landing`, `skill-ux-testing`, `skill-audit-planning`) — trabajo legítimo pero fuera del scope original de "Skills → Agents → AGENTS.md → Workflow → CI → Remediation" que este documento cubre.

**Qué usar para trabajo activo hoy:** para status operativo del rollout (qué PR hizo qué, qué sigue), ver `workflow/quality/capability-integration-map.md` y la metodología de Critical Proofs que describe — ese documento y el proceso `/wf-build`/`/wf-review` actuales son la fuente de verdad viva. Este spec es el registro de la intención original y de dónde se ejecutó tal cual vs. dónde se pivoteó.

---

## 1. Principio operativo y taxonomía del harness

**Diagnóstico central.** Artifact Studio ya tiene bastante conocimiento de arquitectura, planning, testing y revisión. El problema principal no es la ausencia de reglas: demasiadas reglas viven como texto procedimental dentro de skills y workflows, por lo que el agente puede “cumplir el proceso” sin necesariamente comprender bien el código.

La mejora consiste en separar responsabilidades y mover cada conocimiento al nivel donde produce más leverage.

> **Workflow mueve el trabajo. Agent orquesta. Skill piensa.** `AGENTS.md` **restringe. Tests y CI impiden.**

| Capa | Pregunta | Debe contener | No debe contener |
| --- | --- | --- | --- |
| `AGENTS.md` | ¿Qué debe seguir siendo verdad en este scope? | Invariantes, boundaries, owners, reglas de construcción | Pasos de Linear, scoring, comandos de entrega |
| Agent | ¿Quién conduce esta clase de trabajo? | Secuencia de investigación, routing de skills, consolidación | Conocimiento profundo de cada dominio |
| Skill | ¿Cómo razono sobre una clase concreta de problema? | Pregunta cognitiva, método, evidencia, output, stop conditions | Workflow de PR, merge, status o “todo el stack” |
| Workflow | ¿Qué acciones ocurren y en qué orden? | Estados, branch, PR, validaciones, handoffs, merge | Reglas arquitectónicas detalladas |
| Test / CI | ¿Qué regla conocida puede demostrarse mecánicamente? | Types, behavior, imports, boundaries, invariantes, budgets | Juicio arquitectónico contextual |

**Regla de promoción del conocimiento.** Una observación nace normalmente como juicio en REVIEW. Si se repite, debe dejar de depender del reviewer: se convierte en owner/API/pattern y, cuando la condición sea demostrable, en test o architecture check. La meta es que el repositorio recuerde cómo debe ser construido.

### 1.1 Dos responsabilidades del Quality Harness

El harness no debe limitarse a prevención. Tiene dos responsabilidades complementarias:

```text
                    QUALITY HARNESS
                          │
             ┌────────────┴────────────┐
             ▼                         ▼
        PREVENTION                 REMEDIATION
             │                         │
        Build Recon                Debt inventory
        AGENTS                     Severity / impact
        Skills                     Prioritization
        Owners                     Fix / opportunistic
        CI                         Baseline reduction
        Ratchets                        │
             │                         │
             └────────────┬────────────┘
                          ▼
                STRUCTURAL MEMORY
```

**Prevention** reduce la probabilidad de introducir nuevas decisiones incorrectas.

**Remediation** reduce sistemáticamente la deuda que ya existe y que sigue creando riesgo, fricción o ambigüedad.

La relación entre ambas es deliberada:

```text
problema existente
      ↓
remediation
      ↓
canonical owner / contract
      ↓
test / boundary
      ↓
ratchet
      ↓
el problema no vuelve
```

No todo gap existente merece un refactor inmediato. El sistema debe distinguir entre deuda que requiere corrección ahora, deuda que debe planificarse, deuda que conviene corregir cuando una feature vuelva a tocar esa zona y deuda que basta con congelar mediante un ratchet.

---

## 2. Skills: rediseño completo

### 2.1 Problema actual

El caso más claro es `.agents/skills/skill-code-review/SKILL.md`, de aproximadamente 565 líneas. Mezcla revisión técnica con proof-of-work, performance, Architecture Contract, tests, nomenclatura, seguridad, desktop bundle, base de datos, documentación, red flags, formato de findings, scoring, Linear, merge y ledgers.

**Resultado:** el agente dispone de muchas acciones verificables y puede gastar su atención recorriéndolas. Eso produce reviews formalmente completos pero no necesariamente investigaciones profundas sobre ownership, consumers, failure modes o duplicación semántica.

La comparación con Codex es instructiva: su skill `code-review` funciona como un orquestador muy pequeño y capacidades como change-size, testing, breaking changes o context viven separadas. La fuerza no está en la brevedad per se, sino en que cada skill funciona como una lente cognitiva específica.

| Skill actual Artifact Studio | Tamaño aprox. | Problema principal | Tratamiento |
| --- | --- | --- | --- |
| `skill-code-review` | 565 | Review + workflow + scoring + ops mezclados | Desarmar y reconstruir como orquestación pequeña + lenses |
| `skill-frontend` | 898 | Arquitectura, UX, estado, CSS, accesibilidad, patrones y checklists | Adelgazar; mover lookup/reference y extraer sólo decisiones difíciles recurrentes |
| `skill-product-manager` | 700 | Muy completo; parte puede solaparse con BUILD recon | Mantener intención/contrato; separar descubrimiento real del código |
| `skill-architecture` | 376 | Valioso, pero mezcla clasificación con bastante documentación | Conservar como contrato arquitectónico; no convertirlo en recon |
| `skill-corrections` | 125 | Buen ejemplo de reglas, owner y enforcement explícitos | Usar como patrón |

### 2.2 Qué es una skill en el modelo objetivo

**Definición:** una skill representa una decisión difícil recurrente que requiere razonamiento. No es una colección de pasos administrativos ni una enciclopedia del dominio.

Una skill debería tener:

- **Una pregunta principal.** Ej.: “¿Dónde debe implementarse este cambio usando el sistema que ya existe?”
- **Activación explícita.** Señales que justifican cargarla; evitar keywords superficiales.
- **Inputs delimitados.** Diff, owner, siblings, tests y docs concretos; no “leer todo el repo”.
- **Método de investigación.** Qué debe buscar el agente y en qué orden.
- **Output estructurado.** Una decisión o evidencia utilizable por BUILD/REVIEW.
- **Stop conditions.** Cuándo existe un gap real de arquitectura/contexto.
- **Non-goals.** Qué no intenta resolver.

*Tamaño orientativo, no límite rígido: muchas skills deberían poder vivir entre 30 y 120 líneas. Si requieren cientos de líneas, normalmente hay referencias, workflow o varios problemas cognitivos mezclados.*

### 2.3 Arquitectura objetivo de skills

```text
.agents/skills/
  architecture-recon/
    SKILL.md

  skill-architecture/
    SKILL.md

  code-review/
    SKILL.md

  review-correctness/
    SKILL.md
  review-architecture/
    SKILL.md
  review-testing/
    SKILL.md
  review-change-size/
    SKILL.md
  review-runtime-boundaries/
    SKILL.md
  review-security/
    SKILL.md

  skill-performance/
    SKILL.md
  skill-corrections/
    SKILL.md

  skill-frontend/
    SKILL.md
    references/
```

### 2.4 Nueva skill: `architecture-recon`

**Propósito.** Cerrar el hueco entre un brief correcto y una implementación correcta.

El Architecture Contract dice qué layer/runtime/contracts deberían existir. Recon descubre cómo esa intención se materializa en el código real: owner, siblings, consumers, tests y change surface.

**Pregunta única:** ¿Dónde debe vivir este cambio y qué debe reutilizar antes de crear una implementación nueva?

```markdown
---
name: architecture-recon
description: Locate the canonical implementation path before code changes.
---

# Architecture Recon

## Objective
Find the existing implementation path before creating a new one.

## Investigate
1. Canonical owner
2. Relevant siblings
3. Existing abstractions
4. Upstream dependencies
5. Downstream consumers
6. Canonical tests / harnesses
7. Hotspots touched
8. Local AGENTS.md applicable to proposed files

## Classify siblings
- canonical
- consumer
- legacy
- duplicate
- unrelated

## Output
Architecture Recon
- Change intent:
- Domain:
- Canonical owner:
- Existing abstraction:
- Relevant siblings:
- Consumers:
- Contracts touched:
- Hotspots:
- Canonical tests:
- Proposed change surface:
- New abstraction required: yes/no
- Architecture ambiguity: yes/no

## Stop condition
Declare Architecture Gap only when responsibility ownership
or contract choice is materially ambiguous.

Do not stop for ordinary implementation choices.
```

**Regla de contexto.** Hoy `wf-build` evita cargar contexto adicional por deducción propia. La modificación propuesta mantiene ese principio para documentos, pero abre una excepción controlada para code reconnaissance.

BUILD no puede leer docs aleatorios; sí puede inspeccionar código dirigido por preguntas concretas: owner, siblings, consumers y tests.

### 2.5 `code-review`: de checklist a orquestación técnica

**Target:** reducir el skill principal de review a una pieza pequeña. Su trabajo es definir qué significa investigar un cambio y activar las lentes relevantes, no ejecutar toda la operación del PR.

```markdown
---
name: code-review
description: Orchestrate a technical review of the diff.
---

# Code Review

## Purpose
Determine whether the change is correct inside the existing system.

Before findings, reconstruct:
1. behavior changed;
2. owner of that behavior;
3. invariants that depend on it;
4. affected consumers;
5. reused or ignored abstractions;
6. relevant failure modes.

## Evidence
Read the complete diff and enough surrounding code to understand every changed path.
Inspect the owner, relevant siblings and call sites when correctness depends on them.

## Dispatch
Activate only relevant review-* skills.

## Valid finding
Must identify concrete behavior/risk, path + line, cause,
failure condition and fix direction.

Do not report style preferences or merely hypothetical possibilities.

## Priority
Search systemic defects before local defects:
- second owner
- broken contract
- forgotten consumer
- incomplete transition
- ignored canonical abstraction
- happy-path-only behavior
```

### 2.6 Specialist review skills

| Skill | Pregunta principal | Inputs mínimos | Output |
| --- | --- | --- | --- |
| `review-correctness` | ¿Hay una regresión lógica o failure mode concreto? | Diff, surrounding code, transitions, consumers | Findings de behavior/cause/condition |
| `review-architecture` | ¿El cambio respeta owner, layer, contract y source of truth? | Architecture Contract + recon + diff | Boundary/ownership findings |
| `review-testing` | ¿Los tests demuestran el comportamiento modificado y fallos relevantes? | Diff + tests + helpers existentes | Gaps de cobertura con behavior específico |
| `review-change-size` | ¿El cambio sigue siendo una unidad coherente y revisable? | Diff stats, dependencies, call sites | Smallest coherent stage si aplica |
| `review-runtime-boundaries` | ¿Se contaminó shared/web/desktop/cloud o packaging? | Changed paths + runtime rules | Boundary violations y bundle risks |
| `review-security` | ¿Cambian trust boundaries, auth, RLS o secretos? | Diff en scopes sensibles | Security findings concretos |

### 2.7 Ejemplo: `review-correctness`

```markdown
# Review Correctness

## Question
What concrete production behavior can become wrong because of this diff?

## Method
For each changed behavior:
1. identify inputs and state before the change;
2. trace success, failure, interruption and retry paths;
3. inspect consumers that observe the resulting state;
4. verify ownership of each transition;
5. compare with an analogous existing implementation when one exists.

## Look specifically for
- transient state with no exit
- optimistic update without rollback
- two sources of truth
- stale async result overwriting newer state
- partial failure treated as total success
- error swallowed while UI reports success
- behavior correct only after full reload

## Do not
- report generic style issues
- restate lint findings
- infer bugs without a concrete execution path
```

### 2.8 Ejemplo: `review-architecture`

```markdown
# Review Architecture

## Question
Does the diff extend the canonical owner,
or create a second place that knows the same thing?

## Verify
- declared Architecture Contract still matches the code
- responsibility lives in the correct owner
- UI/composition modules do not absorb domain/persistence/runtime semantics
- consumers depend on the owner instead of reproducing logic
- no second source of truth is introduced
- hotspot growth is wiring, not new ownership

## Evidence required for a finding
Name both:
1. the canonical owner/pattern; and
2. the competing implementation introduced by the diff.

If no canonical owner exists, report Architecture Gap
rather than inventing one during review.
```

### 2.9 `skill-frontend`: adelgazar, no fragmentar por cada detalle

No conviene crear `skill-toast`, `skill-empty-state`, `skill-spacing`, etc. El criterio para separar una skill es que represente una decisión difícil recurrente.

| Mantener como skill / posible skill | Mover a reference / doc |
| --- | --- |
| State ownership y lifecycle | Spacing, tipografía detallada, ejemplos visuales |
| Editor / ProseMirror-specific invariants | Catálogo de componentes UI |
| Runtime boundaries | Empty-state patterns |
| Performance architecture | Toast / microcopy conventions |
| Architecture recon | Mapas de semantic IDs cuando sólo son lookup |

### 2.10 Migración de `skill-code-review`

El archivo no se edita incrementalmente hasta quedar “más ordenado”. Se desarma por responsabilidad y se reconstruye una capa cognitiva pequeña.

- **Workflow:** PR format, Linear, estado, merge, ledger, branch/commit traceability.
- **CI:** typecheck, lint, tests, architecture checks, performance budgets.
- **Review Agent:** dispatch, consolidación, formato final, dedupe.
- **Specialist skills:** correctness, architecture, testing, size, runtime, security.
- **Existing domain skills:** performance, corrections, Architecture Contract.

---

## 3. Agents: roles de BUILD y REVIEW

Artifact Studio ya define el concepto de roles en `.agents/agents/README.md`, pero sólo materializa claramente el Product Manager.

La propuesta crea dos roles operativos explícitos: Build Agent y Review Agent. El rol no duplica las skills: las selecciona y coordina.

### 3.1 `build-agent.md`

```markdown
---
name: build-agent
role: implementation-agent
scope: wf-build
---

# Build Agent

Responsibility: turn an approved brief into the smallest coherent
change that fits the existing architecture.

## Before editing
Run Architecture Recon and resolve:
- change intent
- canonical owner
- existing implementation / siblings
- consumers
- canonical tests
- hotspot impact
- expected change surface
- applicable local AGENTS.md

## Construction order
Prefer:
1. extend existing owner;
2. reuse existing abstraction;
3. extract responsibility from a hotspot into an owner;
4. create a new abstraction only when the above do not represent the concept.

## During implementation
If the actual diff materially exceeds the planned change surface
or reveals a different owner, stop editing and rerun recon.

## Hotspots
Hotspots may orchestrate.
They should not acquire new domain, persistence or runtime ownership.
```

### 3.2 `review-agent.md`

```markdown
---
name: review-agent
role: technical-review-agent
scope: wf-review
---

# Review Agent

Responsibility: produce the technical verdict on a PR.
Workflow owns GitHub, Linear, gates and merge.

## Sequence
1. obtain issue intent + diff;
2. reconstruct changed behavior;
3. identify affected domains;
4. read applicable root/local AGENTS.md;
5. load only relevant review-* skills;
6. execute specialist reviews;
7. consolidate and deduplicate findings;
8. reject false positives;
9. produce technical verdict + process insights.

## Investigation priority
1. correctness
2. ownership / architecture
3. failure modes
4. consumers
5. tests
6. maintainability

Green CI is evidence that mechanical rules passed,
not evidence of logical correctness.
```

### 3.3 Product Manager: intención vs reconnaissance

El PM conserva el Architecture Contract porque define la intención de diseño. BUILD recon no lo reemplaza; lo confronta con el código real.

| PM / Architecture Contract | BUILD / Architecture Recon |
| --- | --- |
| Qué debería ser verdad | Dónde vive realmente hoy |
| Layer / runtime / owner esperado | Owner concreto y siblings |
| Contracts touched | Call sites y downstream consumers |
| Invariants que el cambio debe preservar | Tests/harnesses que hoy los demuestran |
| Scope de producto | Change surface de código |

---

## 4. `AGENTS.md`: constitución global y reglas locales

**Modelo:** un `AGENTS.md` raíz corto con reglas universales y muy pocos `AGENTS.md` locales donde el subsistema tenga invariantes propias.

No crear un mini-manual en cada folder.

### 4.1 Root `AGENTS.md`

Debe contener sólo reglas aplicables a prácticamente cualquier cambio: reuse-before-creation, one responsibility/one owner, architecture-before-locality, protección de hotspots, smallest coherent change, tests follow ownership y descubrimiento de instrucciones locales.

```markdown
# Artifact Studio Engineering Rules

## Reuse before creation
Before creating a service, store, hook, helper, state machine,
serializer or persistence path:
1. identify the existing owner;
2. search relevant siblings;
3. inspect consumers and canonical tests.

## One semantic responsibility, one owner
Do not introduce a parallel implementation of a responsibility
that already has a canonical owner.

## Architecture before locality
The closest file is not necessarily the correct place for a change.
Resolve layer, runtime, owner and contract first.

## Protect orchestration hotspots
Central composition modules may wire behavior but should not acquire
new domain, persistence or runtime responsibilities.

## Smallest coherent change
Prefer the smallest change that preserves ownership and contracts;
do not optimize merely for fewest files changed.

## Scoped instructions
Before modifying a subtree, check for a more specific AGENTS.md
and apply it.
```

### 4.2 Local `AGENTS.md`: dónde sí

**Primera ola recomendada:** sólo donde las reglas cambian materialmente y ya existen gravity wells o runtime boundaries.

| Ubicación | Por qué | Reglas candidatas |
| --- | --- | --- |
| `components/editor/AGENTS.md` | Editor es hotspot y concentra lifecycle complejo | `editor-shell` como composition boundary; persistence owner; state ownership; no direct storage |
| `src-tauri/AGENTS.md` | Runtime y packaging propios | commands thin; native owners; SQLite catalog; no web runtime; `index.rs` hotspot |
| `lib/corrections/AGENTS.md` *(fase 2)* | Dominio con invariantes maduras | single admission; single matching; per-item degradation; persistence owner |
| `components/workspace/AGENTS.md` *(fase 2)* | Semántica duplicada y crecimiento | shared document-state projection; query semantics; no second catalog |

### 4.3 Ejemplo `components/editor/AGENTS.md`

```markdown
# Editor Rules

## editor-shell role
`editor-shell.tsx` is a composition boundary.
It may mount subsystems, wire events and coordinate UI composition.

It must not become the canonical owner of persistence,
corrections storage, document identity, tab-domain state,
filesystem access or sync semantics.

## Persistence
Use the canonical persistence owner.
UI components must not write directly to local persistence
when an application/domain owner exists.

## State ownership
Before introducing state, determine its owner and lifecycle.

Do not represent the same semantic state in params + component state
+ store + refs without distinct, explicit lifecycles.

## Existing patterns
Before adding editor behavior, inspect the current owner,
an analogous behavior and its canonical tests.
```

### 4.4 Qué no poner en `AGENTS.md`

- Cómo mover un issue en Linear.
- Cómo hacer merge.
- Cómo calcular el PR score.
- Comandos largos de release.
- Documentación exhaustiva de arquitectura que sólo aplica a un caso.
- Checklists de review que requieren investigación contextual.

---

## 5. Proposed Artifact Studio Quality Architecture

La arquitectura preventiva original se mantiene como backbone. Los cambios posteriores —Build Agent, Review Agent, specialist skills, CI separado y Remediation Plane— viven dentro de ella; no la reemplazan.

```text
                     LINEAR ISSUE
                          │
                          ▼
                  SPEC READINESS GATE
                          │
                          ▼
               BUILD AGENT / ARCH RECON
                          │
           owner · siblings · consumers
           reuse · hotspots · contracts
                          │
                          ▼
                 CHANGE BOUNDARY PLAN
                          │
                          ▼
                CONSTRUCTION CONTRACT
                          │
                          ▼
                       CODING
                          │
                          ▼
                  FAST LOCAL GATES
                          │
             ┌────────────┼────────────┐
             ▼            ▼            ▼
           types       architecture   tests
             └────────────┼────────────┘
                          ▼
                     REVIEW AGENT
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
     correctness      architecture       testing
          │               │                │
          └───────────────┼────────────────┘
                          ▼
                 TECHNICAL VERDICT
                          │
                          ▼
                    BLOCKING CI
                          │
                          ▼
                        MERGE
                          │
                          ▼
                  LEARNING / RATCHET
                          │
                          └──────────────↺
```

Separación de responsabilidades:

```text
BUILD AGENT
→ encuentra el golden path antes de editar.

REVIEW AGENT
→ investiga si el cambio realmente es correcto.

WORKFLOW
→ mueve issue, PR, Linear, ledgers y merge.

CI
→ demuestra reglas mecánicas y bloquea violaciones conocidas.

REMEDIATION
→ corrige selectivamente deuda existente y la convierte en prevención.
```

### 5.1 Architecture control plane

El control plane debe ser pequeño y machine-readable:

```text
architecture/
  owners.yml
  boundaries.yml
  hotspots.yml
  references.yml
  remediation.yml
```

No son cinco documentos ornamentales. Cada archivo alimenta varias capas del harness.

```text
owners / boundaries / hotspots / references
            │
            ├─ architecture recon
            ├─ review
            ├─ scripts
            ├─ CI
            └─ architecture GC

remediation
            │
            ├─ debt triage
            ├─ planned fixes
            ├─ opportunistic cleanup
            └─ baseline reduction
```

Ejemplo de owner/boundary:

```yaml
concept: correction-persistence
owner: lib/corrections/persistence.ts
consumers:
  - editor
forbidden:
  - direct localDB.correctionBlocks writes from components/
```

Ejemplo de hotspot:

```yaml
hotspot: components/editor/editor-shell.tsx
role: composition
policy:
  new_domain_state: forbidden
  new_persistence_paths: forbidden
  new_runtime_adapters: forbidden
```

La misma información debe servir para decidir dónde construir, cómo revisar, qué puede comprobar CI y qué deuda merece remediación.

---

## 6. Workflow: cómo cambian `wf-build` y `wf-review`

### 6.1 `wf-build` objetivo

```text
Issue Brief / Architecture Contract
        ↓
Read root AGENTS.md
        ↓
Build Agent
        ↓
Architecture Recon
  - owner
  - siblings
  - consumers
  - tests
  - hotspots
  - local AGENTS.md
        ↓
Implementation Plan / change surface
        ↓
Load only relevant domain skills
        ↓
Implement
        ↓
Targeted local tests
        ↓
Canonical local quality commands
        ↓
Open PR
```

**Cambio textual clave en workflow:** reemplazar la prohibición amplia “No cargar nada adicional por deducción propia” por una regla más precisa:

> No cargar documentación adicional por intuición; sí hacer repository reconnaissance dirigido y acotado para owner/siblings/consumers/tests.

Esto protege el attention budget sin volver ciego al builder.

### 6.2 `wf-review` objetivo

```text
PR + Issue Intent
      ↓
Mechanical CI status
      ↓
Review Agent
      ↓
Applicable AGENTS.md
      ↓
Specialist skills by scope
      ↓
Independent code investigation
      ↓
Consolidated findings
      ↓
Technical verdict
      ↓
Workflow handles comment / status / merge / ledgers
```

Review deja de comprobar manualmente lo que CI ya puede probar. El reviewer puede mencionar un gate fallido como bloqueo, pero no gasta su presupuesto cognitivo reejecutando checklists de lint, traceability o formato del PR.

---

## 7. CI y GitHub Actions: enforcement mecánico

**Principio:** CI no reemplaza el review. Convierte en bloqueo automático todo conocimiento que ya puede expresarse de forma determinista.

GitHub Actions se organiza por tipo de evidencia, no como un workflow universal.

### 7.1 Problema del estado actual

- `Traceability Gates` mezcla desktop lifecycle, build, process docs, ledgers, status drift, perf y delivery traceability.
- CI y BUILD no comparten exactamente la misma definición de calidad.
- BUILD exige `npm run typecheck`, `npm run lint`, `npm test`; el PR workflow actual no ejecuta explícitamente esos tres checks.
- Performance corre demasiado globalmente.
- Architecture enforcement existe, pero está disperso en tests ligados a fases.

### 7.2 Topología objetivo

```text
.github/workflows/
  blocking-ci.yml       # único entrypoint de merge
  quality.yml           # typecheck, lint, tests, production build
  repo-checks.yml       # architecture + repository invariants
  scoped-ci.yml         # desktop/editor/perf/db según paths
  process-checks.yml    # workflow + traceability
  release-desktop.yml   # artefacto distribuible, separado
```

### 7.3 `blocking-ci.yml`: un solo required check

GitHub debería requerir un único check estable: `CI required`.

Internamente puede cambiar la composición del pipeline sin reconfigurar branch protection cada vez.

```yaml
name: blocking-ci

on:
  pull_request: {}
  push:
    branches: [main]

jobs:
  quality:
    uses: ./.github/workflows/quality.yml

  repo-checks:
    uses: ./.github/workflows/repo-checks.yml

  scoped-ci:
    uses: ./.github/workflows/scoped-ci.yml

  process-checks:
    uses: ./.github/workflows/process-checks.yml

  required:
    name: CI required
    if: ${{ always() }}
    needs: [quality, repo-checks, scoped-ci, process-checks]
    # helper evaluates success/skipped policy and fails otherwise
```

### 7.4 `quality.yml`: evidencia universal

| Job | Comando canónico | Bloquea | Notas |
| --- | --- | --- | --- |
| Typecheck | `npm run typecheck` | Sí | Mismo comando que BUILD |
| Lint | `npm run lint` | Sí | Separado para diagnóstico rápido |
| Behavior tests | `npm test` | Sí | Vitest completo mientras el costo siga razonable |
| Production build | `npm run build` | Sí | Captura fallos de Next/build que tests no ven |

Los jobs deben correr en paralelo cuando no haya dependencia real. El objetivo es feedback rápido y causas legibles.

### 7.5 `repo-checks.yml`: arquitectura como código

Ésta es la pieza de mayor leverage para Artifact Studio. Los tests existentes de boundaries y catálogo ya demuestran que el patrón funciona.

Deben evolucionar de artefactos ligados a fases hacia invariantes permanentes.

```text
tests/architecture/
  runtime-boundaries.test.ts
  document-catalog-boundary.test.ts
  corrections-ownership.test.ts
  persistence-boundary.test.ts
```

```json
{
  "scripts": {
    "test:architecture": "vitest run tests/architecture"
  }
}
```

Primeras reglas candidatas:

- `lib/services/contracts/**` no importa Next, Supabase, browser globals ni filesystem runtime-specific.
- `lib/services/desktop/**` no depende de runtime web.
- Desk / Workspace / Search / Recent / Open Document consumen shared catalog/application ports.
- UI/composition no introduce acceso directo a persistence internals cuando existe un owner canónico.
- Corrections admission y matching tienen una sola implementación canónica.

### 7.6 Architecture ratchet

No declarar “cero violaciones” si el repo ya tiene deuda. Definir boundaries y una baseline conocida.

CI permite deuda existente pero bloquea nuevas violaciones; la baseline sólo puede disminuir.

```yaml
# architecture/boundaries.yml

boundaries:
  ui-no-direct-persistence:
    from:
      - components/**
      - app/**
    forbid:
      - lib/local-db/**
```

```json
{
  "ui-no-direct-persistence": [
    "components/editor/editor-shell.tsx"
  ]
}
```

Regla:

```text
existing baseline violation → allowed temporarily
new violating file          → FAIL
baseline entry removed      → baseline must decrease
baseline growth             → FAIL
```

### 7.7 Hotspot policy

No usar “archivo grande = fail”. El tamaño es señal, no defecto.

| Nivel | Ejemplo | Tratamiento |
| --- | --- | --- |
| Signal / warning | `editor-shell` +180 LOC | Anotar growth; no bloquear por tamaño |
| Structural warning | hotspot agrega nueva store/state machine propia | Review architecture obligatorio |
| Blocking boundary | hotspot agrega import directo a persistence internals | CI FAIL |
| Blocking duplication | aparece segundo matching/admission owner | CI FAIL cuando sea detectable |

### 7.8 `scoped-ci.yml`: checks por área cambiada

| Scope detectado | Checks adicionales |
| --- | --- |
| `src-tauri/**` | `cargo fmt --check`, `cargo test`, clippy, desktop contract tests |
| editor / hot paths | editor integration, Playwright relevante, performance si toca paths definidos |
| workspace | workspace integration + catalog invariants |
| `supabase/migrations/**` | migration/schema validation; RLS tests cuando aplique |
| `.agents/**` / `workflow/**` | context/process validation |
| hot performance path | capture + `ops:perf:gate` |

Un job pequeño calcula changed areas desde base/head SHA y produce outputs.

Los jobs irrelevantes terminan `skipped`; el aggregator acepta `success` o `skipped` según política declarada.

### 7.9 Separar performance de delivery traceability

`ops:delivery:gate` debería volver a una responsabilidad clara: branch/issue/commit traceability.

`ops:perf:gate` ejecuta budgets.

No debe existir un gate “delivery” que condicionalmente se transforme también en performance gate según una variable de entorno.

### 7.10 `process-checks.yml`

- `ops:process:sync` — coherencia de docs de proceso.
- `ops:workflow:validate` — JSON/JSONL parseable e integridad de ledgers.
- `ops:delivery:gate` — rama/issue/commits.
- PR drift check — sólo drift introducido por el PR o corregible por ese PR.
- Global strict drift — en `main` o scheduled health check si la feature branch no puede corregirlo.

**Criterio de un gate bloqueante:** el PR que falla debe poder corregir la causa del fallo.

### 7.11 Release Desktop separado

`release-desktop.yml` responde:

> ¿Puedo producir, firmar y publicar el artefacto?

No debería ser el primer lugar donde se descubren fallos de Rust, runtime boundaries o tests desktop. Eso pertenece al PR CI.

---

## 8. Remediation Plane: corregir deuda existente sin big-bang refactor

> **Nota de estado (2026-09-22):** esta sección describe el plan original. No se implementó así — ver "Estado de implementación" al inicio del documento. `architecture/remediation.yml` y los archivos hermanos (`owners.yml`, `hotspots.yml`, `references.yml`) nunca se crearon. El trabajo real de priorizar y remediar deuda/gaps de cobertura vive hoy en `workflow/quality/capability-integration-map.md`, con un mecanismo de clasificación distinto (coverage_status por escenario de producto, no disposition por gap arquitectónico). Se conserva el texto original abajo sin editar, como registro de la intención.

### 8.1 Por qué hace falta

El harness preventivo evita que Artifact Studio siga produciendo las mismas clases de errores, pero no elimina automáticamente los problemas estructurales que ya existen.

Ejemplos observados:

```text
editor-shell.tsx → direct localDB correction persistence
Workspace        → duplicated document-state semantics
document-service-factory.ts → too many responsibilities
src-tauri/src/commands/index.rs → command layer + domain logic concentration
path semantics → repeated across TS and Rust boundaries
```

Instalar mejores skills, agents o CI puede impedir que estos gaps empeoren. Algunos, sin embargo, requieren corrección deliberada.

Cada gap conocido debe recibir una **disposition** explícita.

### 8.2 Clasificación de remediación

```text
FIX NOW
Riesgo actual de correctness, data integrity, security, identity
o una boundary violation que ya produce comportamiento incorrecto.

PLANNED REMEDIATION
Problema estructural importante que sigue creando fallos,
ambigüedad o retrabajo y amerita un issue dedicado.

OPPORTUNISTIC REMEDIATION
No justifica un refactor aislado, pero la próxima feature que toque
esa zona debe reducir la deuda en lugar de ampliarla.

RATCHET ONLY
Deuda tolerable. Se congela el estado actual y se prohíbe empeorarlo.
```

### 8.3 Criterios para decidir gravedad

No usar LOC como criterio principal.

| Señal | Pregunta |
| --- | --- |
| Correctness / data integrity | ¿Puede producir estado incorrecto, pérdida o corrupción? |
| Multiple owners | ¿Hay dos lugares que interpretan o escriben la misma semántica? |
| Blast radius | ¿Cuántos consumers dependen de la pieza? |
| Change frequency | ¿Seguimos chocando con el problema en features normales? |
| Centrality | ¿Está en identity, persistence, catalog, save/write path o sync? |
| Boundary violation | ¿Cruza capas/runtimes de forma que dificulta razonar el sistema? |
| Repeated findings | ¿Ya reapareció en review o bugs? |
| Collision surface | ¿Impide trabajo paralelo o concentra demasiados cambios? |

No hace falta convertir esto en un score matemático rígido. Su función es producir una disposition razonada.

### 8.4 Clasificación inicial de deuda ya detectada

| Gap actual | Disposition inicial | Razón |
| --- | --- | --- |
| `editor-shell.tsx` escribe `localDB.correctionBlocks` directamente | Planned; Fix now si ya genera bugs activos | Existe owner de corrections persistence y hay boundary erosion concreta |
| Workspace duplica `deriveWorkspaceFileDocumentState` | Planned | Semántica de producto duplicada; riesgo de drift |
| `editor-shell.tsx` \~7k líneas | Ratchet + opportunistic | El tamaño solo no justifica refactor; sí impedir nuevas responsabilidades |
| `document-service-factory.ts` concentra demasiadas operaciones | Opportunistic | Extraer owners al tocar esas operaciones |
| `src-tauri/src/commands/index.rs` concentra commands + lógica | Ratchet + staged extraction | Thin command layer como dirección; no big bang |
| Path semantics duplicados | Planned si afectan identity/cross-platform; si no opportunistic | Riesgo depende del boundary y del impacto real |
| Helpers cosméticos duplicados | No priority | Bajo riesgo estructural |

### 8.5 `architecture/remediation.yml`

`remediation.yml` no es un backlog general. Sólo registra deuda arquitectónica activa que necesita decisión y una condición de salida.

```yaml
id: editor-direct-correction-persistence

area: editor

evidence:
  component: components/editor/editor-shell.tsx
  canonical_owner: lib/corrections/persistence.ts

problem:
  editor-shell writes correction persistence directly

risk:
  type: ownership-boundary
  blast_radius: high
  recurrence: active

disposition: planned-remediation

exit:
  - editor-shell no longer writes correctionBlocks directly
  - persistence owner is the only write path
  - architecture boundary test passes

after_remediation:
  enforce:
    - ui-no-direct-correction-persistence
```

### 8.6 Remediation termina en prevention

Una remediación no se considera completa sólo porque se movió código.

```text
debt
  ↓
fix
  ↓
canonical owner
  ↓
test / boundary
  ↓
baseline reduction
  ↓
future regression blocked
```

Siempre que el problema sea mecánicamente detectable, la condición final de la remediación debe convertirse en test, architecture check o CI gate.

### 8.7 Qué no hacer

- No crear un “refactor project” para cada hotspot.
- No usar thresholds de LOC como prioridad automática.
- No convertir `remediation.yml` en un inventario infinito de pequeñas imperfecciones.
- No detener delivery normal para “limpiar el repo”.
- No reparar toda la deuda antes de activar ratchets.
- No extraer abstracciones sin un owner y un caso de uso claros.

Política por defecto:

> **Fix severe debt deliberately; reduce structural debt opportunistically; ratchet everything mature enough to enforce.**

---

## 9. Learning loop: convertir findings en memoria estructural

```text
REVIEW FINDING
     ↓
¿Es específico de este cambio? ── sí ──> fix local
     │
     no / se repite
     ↓
¿Existe owner o regla canónica?
     ├─ no → Architecture decision / owner
     └─ sí
          ↓
¿Puede demostrarse mecánicamente?
     ├─ sí → test / repo-check / CI
     └─ no → AGENTS.md local o specialist skill
          ↓
future agents discover the golden path
```

**Regla práctica:** ningún finding repetido tres veces debería permanecer únicamente como conocimiento del reviewer.

| Tipo de aprendizaje | Destino preferido |
| --- | --- |
| “Existe un owner y no debe haber un segundo” | `AGENTS.md` + boundary test cuando sea posible |
| “Antes de crear hay que buscar siblings/consumers” | `architecture-recon` |
| “Este runtime no puede importar aquel módulo” | repo-check / CI |
| “Este failure mode requiere razonamiento contextual” | `review-correctness` |
| “Este path es performance-sensitive” | scoped CI + performance registry |
| “Este hotspot no debe adquirir esa responsabilidad” | local `AGENTS.md` + ratchet |

---

## 10. Plan de implementación incremental

La implementación evita una migración big bang. Cada fase debe dejar el sistema usable y reducir carga cognitiva.

### Fase 1 — Separar thinking de workflow ✅ Hecho — PR [#433](https://github.com/hugomarin/Odessay/pull/433)

- Crear `architecture-recon/SKILL.md`.
- Crear `build-agent.md` y `review-agent.md`.
- Reducir `skill-code-review` a orquestación técnica; mover Linear/merge/ledger al workflow.
- Crear inicialmente `review-correctness`, `review-architecture`, `review-testing`, `review-change-size`.
- Modificar `wf-build` para ejecutar recon antes de editar.

**Exit criteria:** un BUILD nuevo declara owner/siblings/consumers/tests/change surface; un REVIEW puede ejecutarse sin leer 565 líneas de checklist operativo.

### Fase 2 — Hacer context local y proteger hotspots ✅ Hecho

- Adelgazar root `AGENTS.md` a reglas globales.
- Crear `components/editor/AGENTS.md` y `src-tauri/AGENTS.md`.
- Registrar hotspots canónicos.
- Refactorizar `skill-frontend`: mover referencias; conservar decisiones difíciles recurrentes.

**Exit criteria:** el builder descubre instrucciones del subtree sólo cuando su change surface entra en ese dominio.

### Fase 3 — Reestructurar GitHub Actions ✅ Hecho — PR [#434](https://github.com/hugomarin/Odessay/pull/434)

- Crear `blocking-ci.yml` con aggregator `CI required`.
- Separar `quality.yml`, `repo-checks.yml`, `process-checks.yml`, `scoped-ci.yml`.
- Hacer explícitos `typecheck`, `lint`, `npm test`, `npm run build`.
- Verificar en GitHub Settings que `CI required` quede realmente requerido para merge.

**Exit criteria:** un PR ve categorías claras de evidencia; BUILD y CI comparten comandos canónicos.

### Fase 4 — Architecture ratchets ✅ Hecho — PR [#435](https://github.com/hugomarin/Odessay/pull/435)

- Consolidar boundary tests existentes en `tests/architecture/`.
- Crear `architecture/boundaries.yml` y baseline.
- Primera regla: UI/composition → persistence internals.
- Siguientes: catalog consumers → shared catalog ports; corrections → single owner.

**Exit criteria:** CI impide al menos una clase de boundary erosion que hoy sólo detecta REVIEW.

### Fase 5 — Scoped CI y promotion loop ✅ Hecho — PR [#436](https://github.com/hugomarin/Odessay/pull/436)

- Detectar changed areas y correr desktop/editor/perf/db checks condicionales.
- Mover performance fuera de delivery gate.
- Crear procedimiento de promoción de repeated findings a tests/`AGENTS.md`/skills.
- Revisar periódicamente findings repetidos y baseline de arquitectura.

### Fase 6 — Current Debt Triage + staged remediation ❌ No implementado tal cual — divergió al Capability Integration Map

- Crear `architecture/remediation.yml`.
- Clasificar gaps actuales en Fix now / Planned / Opportunistic / Ratchet only.
- Seleccionar sólo 1–2 deudas estructurales de alto impacto para remediación inicial.
- Primeros candidatos:
  - editor direct correction persistence;
  - Workspace duplicated document-state projection.
- Cada remediación termina en owner claro + test/boundary + reducción de baseline.

**Exit criteria:** ningún gap crítico queda sólo descrito en la auditoría; cada deuda relevante tiene disposition y las remediaciones completadas producen una regla preventiva durable.

> **No cumplido tal cual.** En vez de `remediation.yml`, PR [#437](https://github.com/hugomarin/Odessay/pull/437) creó `workflow/quality/capability-integration-map.md` (106 escenarios auditados, `coverage_status` real por escenario) y una serie de "Critical Proofs" (PRs [#438](https://github.com/hugomarin/Odessay/pull/438)-[#443](https://github.com/hugomarin/Odessay/pull/443), issues ODE-544/545/546/548/549/550) que cierran escenarios uno por uno con Proof Contract + mutation-testing. Los candidatos de deuda que esta fase nombraba (editor direct correction persistence, Workspace duplicated document-state) no tienen disposition formal en ningún archivo — siguen como conocimiento tácito, no capturado en `remediation.yml` ni en el capability map (que audita comportamiento de producto, no deuda arquitectónica interna).

### 10.1 Orden sugerido de PRs

| PR | Cambio | Riesgo | Valor | Estado |
| --- | --- | --- | --- | --- |
| 1 | Architecture Recon + Build Agent + actualizar `wf-build` | Bajo-medio | Mejora first-pass inmediatamente | ✅ [#433](https://github.com/hugomarin/Odessay/pull/433) |
| 2 | Review Agent + split de `skill-code-review` + 4 specialist skills | Medio | Libera attention budget de REVIEW | ✅ [#433](https://github.com/hugomarin/Odessay/pull/433) (junto con PR 1) |
| 3 | Root/local `AGENTS.md` cleanup + editor/src-tauri scoped rules | Medio | Context just-in-time + hotspot protection | ✅ Hecho (sin PR propio identificado — root `AGENTS.md`, `components/editor/AGENTS.md`, `src-tauri/AGENTS.md` existen) |
| 4 | `blocking-ci` + quality/process split | Medio | CI legible y consistente con BUILD | ✅ [#434](https://github.com/hugomarin/Odessay/pull/434) |
| 5 | Consolidar architecture tests + primer ratchet | Medio-alto | Enforcement estructural real | ✅ [#435](https://github.com/hugomarin/Odessay/pull/435) |
| 6 | Scoped CI + separación de performance | Medio | Feedback más rápido y menos ruido | ✅ [#436](https://github.com/hugomarin/Odessay/pull/436) |
| 7 | Debt triage + primera staged remediation | Medio | Empieza a reducir deuda, no sólo a congelarla | ❌ Divergió — ver Fase 6 arriba. [#437](https://github.com/hugomarin/Odessay/pull/437) en adelante construyó el Capability Integration Map en su lugar |

---

## 11. Definition of Done y métricas

### 11.1 Definition of Done del harness refactor

- `skill-code-review` ya no contiene operación de Linear, merge o ledger.
- BUILD no edita antes de producir Architecture Recon para cambios no triviales.
- Root `AGENTS.md` contiene sólo reglas universales.
- Local `AGENTS.md` existe sólo donde cambia el contrato.
- CI ejecuta typecheck/lint/tests/build explícitamente y usa los mismos comandos que BUILD.
- Existe un único required check agregado en GitHub.
- Existe al menos un architectural ratchet bloqueante.
- Performance y desktop checks se activan por scope.
- Un repeated review finding tiene ruta definida hacia memoria estructural.
- Existe `architecture/remediation.yml` o mecanismo equivalente.
- Cada gap arquitectónico relevante tiene disposition.
- Al menos una remediación termina en reducción de baseline + enforcement preventivo.

### 11.2 Métricas útiles

| Métrica | Qué indica | Evitar optimizar como |
| --- | --- | --- |
| First-review failure rate | Calidad del first pass | Score cosmético |
| Review rounds por PR | Retrabajo | Velocidad bruta |
| Findings “existing abstraction ignored” | Calidad del recon | Número total de findings |
| Findings “wrong owner / missed consumer” | Entendimiento del sistema | LOC |
| % PRs que agregan responsabilidad a hotspots | Erosión arquitectónica | Tamaño aislado de archivos |
| New architecture violations | Efectividad del ratchet | Cantidad de reglas |
| Repeated findings promoted | Capacidad de aprendizaje | Cantidad de docs |
| CI failures discovered after review | Huecos mecánicos | Cantidad de jobs |
| Active structural debt by disposition | Riesgo conocido todavía abierto | Reducir items cosméticamente |
| Baseline reduction rate | Convergencia real de ratchets | “Cero deuda” artificial |
| Remediations converted to enforcement | Correcciones que se vuelven durables | Número de refactors |

**North star:** no perseguir más checks ni un score de review más alto. La señal correcta es que el sistema necesite cada vez menos memoria humana para evitar los mismos errores, mientras las decisiones nuevas siguen siendo visibles y revisables.

---

## Apéndice A. Árbol objetivo de archivos

```text
Artifact Studio/
├── AGENTS.md
├── architecture/
│   ├── boundaries.yml
│   ├── baseline.json
│   ├── owners.yml
│   ├── hotspots.yml
│   ├── references.yml
│   └── remediation.yml
│
├── .agents/
│   ├── agents/
│   │   ├── README.md
│   │   ├── product-manager.md
│   │   ├── build-agent.md
│   │   └── review-agent.md
│   │
│   └── skills/
│       ├── architecture-recon/SKILL.md
│       ├── skill-architecture/SKILL.md
│       ├── code-review/SKILL.md
│       ├── review-correctness/SKILL.md
│       ├── review-architecture/SKILL.md
│       ├── review-testing/SKILL.md
│       ├── review-change-size/SKILL.md
│       ├── review-runtime-boundaries/SKILL.md
│       ├── review-security/SKILL.md
│       ├── skill-performance/SKILL.md
│       ├── skill-corrections/SKILL.md
│       └── skill-frontend/
│           ├── SKILL.md
│           └── references/
│
├── components/
│   └── editor/
│       └── AGENTS.md
│
├── src-tauri/
│   └── AGENTS.md
│
├── tests/
│   └── architecture/
│       ├── runtime-boundaries.test.ts
│       ├── document-catalog-boundary.test.ts
│       ├── corrections-ownership.test.ts
│       └── persistence-boundary.test.ts
│
└── .github/workflows/
    ├── blocking-ci.yml
    ├── quality.yml
    ├── repo-checks.yml
    ├── scoped-ci.yml
    ├── process-checks.yml
    └── release-desktop.yml
```

---

## Apéndice B. Migración de `skill-code-review`

| Contenido actual | Destino objetivo | Acción |
| --- | --- | --- |
| PR format | workflow | Mover |
| Proof of work | workflow + CI | Mover; CI demuestra |
| typecheck / lint / `npm test` | `quality.yml` | Mover a enforcement |
| Performance Architecture Contract | `skill-performance` | Referenciar, no repetir |
| Architecture Contract | `skill-architecture` + brief | Referenciar |
| Architecture contract review | `review-architecture` | Extraer |
| Tests checklist | `review-testing` | Extraer y volver conductual |
| Transition / state red flags | `review-correctness` | Extraer |
| Desktop bundle checks | `review-runtime-boundaries` + scoped CI | Separar juicio vs mecánico |
| DB checks | scope DB/security sólo si hay pregunta cognitiva clara | Extraer condicionalmente |
| Security checks | `review-security` | Extraer |
| Docs mínimas por scope | workflow/context routing | Mover |
| Finding schema | `review-agent` | Mantener pequeño |
| Severity/confidence | `review-agent` / scoring ref | Conservar como metadata |
| PR Quality Score | `scoring.md` o simplificar | Secundario; no centro del review |
| Context risk | `review-agent` + ProcessInsights | Conservar |
| Linear integration | workflow | Mover |
| review-history / ledgers | workflow/process-checks | Mover |
| Merge behavior | workflow | Mover |
| Claude specialist dispatch | `review-agent` | Hacer arquitectura principal, no enhancement opcional |
| Red team / adversarial | `review-agent`, condicional | Sólo para scopes de alto riesgo |

---

## Apéndice C. Gap Matrix: prevención vs remediación

El Gap Matrix no debe leerse como una lista en la que todos los problemas desaparecen al instalar el harness. Distingue entre gaps del sistema de desarrollo y deuda ya presente en el producto.

| Gap | Tipo | Prevention mechanism | Remediation mechanism | Disposition inicial |
| --- | --- | --- | --- | --- |
| BUILD no hace reconnaissance | Harness | Architecture Recon | N/A | Implementar |
| No Build Agent | Harness | `build-agent.md` | N/A | Implementar |
| Global construction rules débiles | Harness | Root/local `AGENTS.md` | N/A | Implementar |
| Skill attention overload | Harness | Skill decomposition | N/A | Implementar |
| REVIEW sobre-especificado | Harness | Review Agent + specialist lenses | Retirar workflow/ops del reviewer | Implementar |
| CI ≠ BUILD contract | Harness | Blocking CI + canonical commands | N/A | Implementar |
| Architectural boundaries localizados | Harness | Repo architecture checks | Consolidar tests existentes | Implementar |
| Learning sin promotion protocol | Harness | Learning loop | Promover findings repetidos existentes | Implementar |
| EditorShell gravity well | Codebase debt | Hotspot policy | Ratchet + opportunistic extraction | Ratchet / Opportunistic |
| Workspace semantic duplication | Codebase debt | Single-owner rule | Canonical projection owner | Planned |
| Service factory posee demasiado | Codebase debt | Owner-before-creation | Staged extraction al tocar operaciones | Opportunistic |
| UI alcanza persistence internals | Codebase debt | Persistence boundary | Mover write path al canonical owner | Planned / Fix now si activo |
| Tauri commands demasiado concentrados | Codebase debt | Thin-command boundary | Staged extraction | Ratchet / Opportunistic |

La pregunta para cada fila es doble:

```text
¿Cómo evitamos que aparezca otra vez?
¿Cómo reducimos lo que ya existe?
```

Si sólo respondemos la primera, el repositorio deja de empeorar pero no necesariamente mejora.

Si sólo respondemos la segunda, corregimos deuda pero seguimos generándola.

El Quality Harness necesita ambas.
