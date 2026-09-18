---
name: architecture-recon
description: Localiza el owner canónico, siblings, consumers y tests reales antes de escribir código. Usar en BUILD antes de implementar cualquier cambio no trivial, para no crear una segunda implementación de algo que ya tiene dueño.
---

# Skill: Architecture Recon

Cierra el hueco entre un brief correcto y una implementación correcta.

`.agents/skills/skill-architecture/SKILL.md` responde **qué debería ser verdad**: `Layer`, `Runtime scope`, `Owner` esperados, contratos e invariantes declarados en el brief. Este skill responde una pregunta distinta:

> ¿Dónde vive realmente hoy esa responsabilidad en el código, y qué debo reutilizar antes de crear algo nuevo?

No reemplaza al `Architecture Contract`. Lo confronta contra el código real.

---

## Cuándo activar este skill

Actívalo en BUILD para cualquier cambio no trivial, antes de escribir la primera línea de implementación. Es especialmente obligatorio si el brief:

- introduce un servicio, store, hook, helper, state machine, serializer o path de persistencia nuevo
- toca un dominio con owner conocido (corrections, document catalog, sync, sharing, auth)
- toca un hotspot ya identificado (`components/editor/editor-shell.tsx`, `src-tauri/src/commands/index.rs`, `document-service-factory.ts`)
- tiene `Architecture Contract` activo según `skill-architecture`

No hace falta para fixes de una línea, ajustes de copy/estilo aislados o cambios que no crean ni mueven ownership.

---

## Regla de contexto

Leer el código relevante para resolver owner/siblings/consumers/tests es parte normal de BUILD, no una excepción — esta skill define cómo hacerlo de forma dirigida y acotada (**repository reconnaissance**, código, no documentos). La restricción real es otra: `wf-build` no carga documentación de producto adicional por intuición. Esa restricción sigue firme y aplica solo a documentos — nunca a código. Esta skill no autoriza leer documentación de producto, roadmap o features fuera de lo que el brief ya citó en `Reference docs`.

---

## Investigar

Para el change surface declarado en el brief, resolver en orden:

1. **Owner canónico** — el archivo/módulo que hoy posee esta responsabilidad. Buscar por nombre de dominio, no solo por ruta obvia (`grep`/`Explore` sobre el concepto, no solo sobre el archivo más cercano).
2. **Siblings relevantes** — implementaciones vecinas del mismo tipo de responsabilidad (otros services, otros stores, otros adapters del mismo runtime).
3. **Reusable API / abstraction** — ¿ya existe algo que puedas llamar directamente para resolver esto? (ej. ya existe `DocumentService` con el método que necesitas → úsalo, no lo repliques). Esto es reuso: la responsabilidad ya vive en código, no hace falta escribir nada nuevo para ella.
4. **Canonical reference / sibling** — solo si genuinamente necesitas crear algo nuevo (ningún owner ni abstracción resuelve el concepto): ¿hay un sibling análogo que sirva de ejemplo de **forma**, no de contenido? (ej. vas a crear un `SyncService` nuevo → mira cómo está estructurado `AuthService` para mantener consistencia de diseño, sin copiar su lógica de dominio). Un pattern de referencia no es una abstracción para reusar — es un ejemplo de cómo este repo construye esa clase de pieza.
5. **Dependencias upstream** — de qué depende hoy el owner (contratos, tipos, otros services).
6. **Consumers downstream** — quién llama/importa/renderiza lo que se va a modificar. Un consumer olvidado es la causa más común de regresión silenciosa.
7. **Tests canónicos** — qué test(s) ya demuestran el comportamiento actual de esa pieza. Si no existen, es una señal que se registra en el output — probablemente el test se crea durante la implementación — y nunca por sí sola motivo para detener BUILD.
8. **Hotspots tocados** — si el change surface cae dentro de un archivo/módulo ya identificado como hotspot (ver `Construction order` en `.agents/agents/build-agent.md`), declararlo explícitamente. Si el owner de la responsabilidad ya es claro, esto es una decisión de wiring, no una ambigüedad — ver `Hotspots` en `build-agent.md`.
9. **AGENTS.md local aplicable** — si el change surface cae dentro de `components/editor/**` o `src-tauri/**`, leer el `AGENTS.md` de ese subtree antes de implementar. Para cualquier otro subtree, aplican solo las reglas universales del `AGENTS.md` raíz.

---

## Clasificar siblings

Cada sibling encontrado se clasifica como uno de:

- `canonical` — es el owner real, hay que extenderlo
- `consumer` — depende del owner, hay que revisar que no se rompa
- `legacy` — camino en migración; no expandir salvo que el issue actual posea explícitamente esa migración
- `duplicate` — segunda implementación de la misma responsabilidad; señal de posible `Architecture Gap`, no lo resuelvas por tu cuenta
- `unrelated` — descartar

---

## Output

Producir explícitamente antes de implementar:

```text
Architecture Recon
- Change intent:
- Domain:
- Canonical owner:
- Reusable API / abstraction: (algo que ya existe y se puede llamar directamente)
- Canonical reference / sibling: (solo si hace falta crear algo nuevo — patrón de forma, no de contenido)
- Relevant siblings: (con su clasificación)
- Consumers:
- Contracts touched:
- Hotspots:
- Canonical tests:
- Proposed change surface:
- New abstraction required: yes/no
- Architecture ambiguity: yes/no
```

Si el brief ya trae `Architecture Contract` (de `skill-architecture`), este output debe referenciarlo, no repetirlo — Recon aporta las rutas y evidencia concreta del código; el Contract aporta la intención declarada.

---

## Persistencia

El Architecture Recon completo es **working context** del Build Agent — no se persiste por defecto como documento del repositorio. Sirve para construir bien este cambio, no para quedar archivado.

```text
Recon                    → contexto temporal para construir bien
Hallazgo reusable        → Linear (comentario o Issue Brief)
Regla madura y recurrente → después: AGENTS.md / architecture / test / CI
```

Si Recon descubre una decisión o aprendizaje útil más allá del issue actual (ej. "este archivo es el owner canónico de X, no lo dupliques"), registrar únicamente ese hallazgo en Linear — como comentario o actualización del Issue Brief —, no el Recon entero:

```text
Architecture finding:
`lib/corrections/persistence.ts` es el canonical owner de
corrections persistence. `editor-shell.tsx` debe limitarse
a wiring y no introducir nuevos persistence paths.
```

No persistir observaciones triviales ni información fácilmente redescubrible desde el código con un Recon nuevo. Si el mismo hallazgo se repite en varios issues, ya no es un hallazgo puntual de Linear — sigue el `Learning loop` del quality harness: se convierte en regla de `AGENTS.md` local, en `architecture/*` o en un boundary check cuando sea mecánicamente demostrable.

---

## Stop condition

Declarar `Context Gap — Architecture Recon` solo cuando el ownership o la elección de contrato sea **materialmente ambiguo**: dos siblings `canonical` plausibles, un `duplicate` que contradice al owner declarado en el brief, o un consumer cuyo comportamiento esperado no puede inferirse sin asumir arquitectura.

No detenerse por decisiones de implementación ordinarias (nombrar una función, elegir estructura interna de un archivo nuevo dentro de un owner ya claro, etc.). En particular, la ausencia de tests canónicos **nunca** es, por sí sola, motivo de `Context Gap` — ver punto 7 de `Investigar`. Owner/contrato ambiguo detiene BUILD; tests faltantes no.

Reporte mínimo, siguiendo el mismo formato que `skill-architecture`:

```text
Context Gap — Architecture Recon
Source: <archivo(s) encontrados>
Observed behavior: <qué hace hoy el código>
Ambiguity: <qué decisión de ownership/contrato no puede resolverse sin arquitectura>
Classification: duplicate-owner | contradicts-brief | normative-conflict
Required action: <corregir brief | issue de migración | decisión humana>
```

---

## Non-goals

- No decide `Layer`/`Runtime scope`/`Owner` esperados — eso es `skill-architecture`.
- No escribe el Issue Brief ni el `Architecture Contract` — eso es DEFINE/`skill-product-manager`.
- No ejecuta el review técnico del PR — eso es `skill-code-review` en `/wf-review`.
- No es una auditoría exhaustiva del repo: se acota estrictamente al change surface del issue actual.

---

## Relación con otros skills

- `skill-architecture` fija la intención (`Layer`, `Runtime scope`, `Owner`, contratos, invariantes). Este skill la confronta contra el código real.
- `skill-product-manager` no usa este skill directamente: Recon es de BUILD, no de DEFINE.
- `skill-frontend` / `skill-backend` / `skill-database` se cargan **después** de Recon, ya acotados al owner/siblings que Recon identificó — no antes, por deducción propia.
