# DAG, olas, merges y gates

Cómo convertir una tanda de issues en el grafo que ejecuta el coordinador. Las lecciones citadas (S1–S7, R9 y otras) están en `lessons.md`.

## 1. Nodos: uno por PR

- Un nodo es **un PR**, no un issue. Un issue que el Recon Pack parte en pasos genera varios nodos: `<n>-PR1`, `<n>-PR2`, o `<n>-A` y `<n>-B` cuando son mitades distintas (por ejemplo, "sin base de datos" y "contra la base local").
- Un nodo de solo docs también es un nodo (por ejemplo, la corrección de un diagnóstico).
- **Cada nodo lleva:**
  - su **trabajo** en una línea;
  - su **tamaño**: XS, S, M o L. Si un L pasa de unas 800 líneas, se parte;
  - si es **parcial** (no es el último PR del issue): el issue sigue In Progress y su fila de ledger lleva "PARTIAL DELIVERY".
- Un nodo que necesita un brief que aún no existe (por ejemplo, el segundo PR de un issue que se redefine) se marca **"no se despacha sin brief por wf-define + lint en verde"**.

## 2. Aristas duras (depende de, mergeado)

Una arista `A → B` significa que B no se lanza hasta que A está **mergeado en main**. Se crea una arista cuando:

1. **Hay una dependencia declarada:** "blocked by" en el tracker, o "depende de" en el Recon Pack o en las Decisiones.
2. **Hay un archivo compartido** (grafo de conflictos del mapa de Recon): owner de producción, doble del harness, fixture o test. **No cuentan** el mapa de capabilities, el catálogo de harnesses ni los ledgers: son filas distintas o append-only con `merge=union`.
   - El orden lo fija el Recon. Si el mapa no lo fija, gana el que desbloquea más.
   - Si los dos regeneran el mismo fixture, se escribe la regla: "el que mergea segundo lo regenera".
3. **Hay un recurso compartido con estado:** por ejemplo, el nodo que crea el harness de la base local va primero y **solo**, sin otro worker usándola.
4. **Hay un gate humano** (§ 5): el nodo depende del gate resuelto.
5. **Una fase de preparación lo exige:** todo depende de la fase 0R (el mapa mergeado) y de la fase H (las decisiones escritas).

**Comprobar** que no hay ciclos y que ninguna arista apunta a una rama sin mergear (S5).

## 3. Olas

- **Ola N** = los nodos cuya cadena de dependencias se cumple después de la ola N−1. Los nodos sin conflicto entre sí van en la misma ola (S1).
- **Concurrencia:** como máximo **3 builders a la vez** en la misma máquina, y como máximo **2 `npm test` completos simultáneos** (S2). Las reviews pueden ir en paralelo, una por PR.
- **Prioridad al llenar un hueco:**
  1. lo Urgent;
  2. lo que desbloquea más nodos;
  3. el orden de la tabla.
- Un nodo de la ola N+1 puede arrancar antes de que cierre la ola N si **todas sus aristas** están mergeadas. La ola es un orden, no una barrera.

## 4. Merges

- **De uno en uno** (S4). Antes de cada merge, `update-branch`.
  - Si el único conflicto está en el mapa de capabilities o en el catálogo de harnesses, lo resuelve el reviewer: conserva las dos filas, repite el recuento y espera el CI verde.
  - Cualquier otro conflicto vuelve al builder.
- **Orden preferente por ola,** cuando hay varios PASS a la vez: los más pequeños y los que desbloquean, primero. Un PR aprobado **no espera** a otro que no está listo, salvo que haya una arista dura entre los dos.
- Después de cada merge, el coordinador avisa a los builders con PR abierto en la misma ola que mergeen `origin/main` (S6).

## 5. Gates humanos

Cada tarea humana de la Auditoría se convierte en un gate de Orca (`gate-create` / `gate-resolve`) con:

| Campo | Contenido |
|---|---|
| **Id** | G1, G2… |
| **Momento** | Antes de un nodo, antes del merge de un PR o después del merge de un PR |
| **Mensaje exacto** | Lo que el coordinador le escribe al humano: corto, accionable y con el archivo o la consulta exactos. Ejemplo: "Abre Docker.app y espera a que la ballena deje de moverse; responde 'listo'." |
| **Verificación** | Cómo comprueba el coordinador que se cumplió (por ejemplo, `docker info` con exit 0) |
| **Qué sigue mientras tanto** | Qué parte del DAG puede avanzar sin el gate |

Gates típicos:
- un recurso local (Docker);
- una **consulta de solo lectura en producción** antes de un merge que cambia accesos;
- una **migración en producción** después del merge: el issue queda In Review hasta resolverse;
- un aviso al humano sin espera (por ejemplo, "puedes cerrar Docker").

## 6. La tabla del prompt

Columnas: `Id | Trabajo | Depende de (mergeado) | Ola | Tamaño`. Los gates van como filas propias en negrita. Debajo de la tabla:
- la prioridad al llenar huecos;
- el orden preferente de merge por ola;
- los gates con su mensaje y verificación;
- el fin del encargo: después de la última ola, parar y reportar; no empezar nada fuera de la tabla, y nombrar lo que **no** se debe empezar aunque parezca listo.

## 7. Comprobaciones del grafo

- [ ] Todos los issues de la tanda tienen al menos un nodo, y no hay nodos de otros issues.
- [ ] Toda arista tiene su motivo (dependencia declarada, archivo compartido, recurso, gate o fase).
- [ ] No hay ciclos. Los nodos de la ola 1 solo dependen de 0R y H.
- [ ] Cada recurso compartido con estado tiene dueño, orden y regla de uso.
- [ ] Los nodos parciales y los que esperan brief están marcados.
