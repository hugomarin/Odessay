# Specialist: Performance Review

Checklist especializado para revisar performance. Aplicar contra el diff.

---

## Critical Path — editor, auto-save, sync

Si el diff toca cualquiera de estos, aplicar con máxima rigor:

- [ ] ¿Ningún keystroke dispara re-render fuera del editor island?
- [ ] ¿No hay `useEffect` que escuche cambios de editor para actualizar store global?
- [ ] ¿Sync remoto tiene debounce >= 1500ms?
- [ ] ¿AI observaciones no bloquean el hilo principal?
- [ ] ¿No se agregó dependencia de UI pesada sin presupuesto medido?

## Queries y base de datos

- [ ] ¿Nueva query tiene índice adecuado?
- [ ] ¿Evita N+1 queries (especialmente en correspondences con árbol)?
- [ ] ¿Paginación es cursor-based, no offset?
- [ ] ¿No hay `select('*')` innecesario?

## Frontend

- [ ] ¿Nuevo componente usa lazy load si no es critical path?
- [ ] ¿No hay `useState` que cause re-render en ancestros del editor?
- [ ] ¿Imágenes/assets nuevos tienen tamaño razonable?
- [ ] ¿No se importa toda una librería cuando solo se usa una función?

## Presupuestos de performance

Si el issue declara `Performance Contract: required`:
- [ ] ¿Hay trace `before` en `artifacts/perf/`?
- [ ] ¿Hay trace `after` en `artifacts/perf/`?
- [ ] ¿`ops:perf:gate` pasa sin `required_failures`?

## Output esperado

Output: SOLO líneas JSON. Nada de texto libre, markdown, headers o comentarios.

Para cada finding:
```json
{"severity":"CRITICAL|HIGH|MEDIUM|LOW","confidence":N,"path":"file","line":N,"category":"performance/{categoria}","summary":"{descripción}","fix":"{recomendación}","specialist":"performance"}
```

Categorías: `editor-island-violation`, `missing-debounce`, `n-plus-one`, `missing-index`, `heavy-dependency`, `no-lazy-load`

Si no hay findings: output `NO FINDINGS` y nada más.
Do not output anything else — no preamble, no summary, no commentary, no markdown blocks.
Output ONLY raw JSON lines. No prose.
