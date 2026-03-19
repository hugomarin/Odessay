---
name: skill-code-review
description: Estándares de code review y checklist de entrega para Odessay. Consulta este skill antes de abrir un PR. Autoevalúa tu trabajo con este checklist.
---

# Skill: Code Review (Odessay)

---

## Principio rector

Un PR debe ser mergeable por alguien que no escribió el código. Debe ser claro, completo, y no romper nada.

**Y cada PR debe responder esta pregunta:**

> ¿Este cambio hace que la app se sienta más rápida e inmediata, o la vuelve más pesada y frágil?

Si no hay una respuesta clara, el PR necesita más trabajo.

---

## PR — Formato

Cada PR debe incluir:

- **Título:** `feat: {descripción corta}` o `fix: {descripción corta}`
- **Issue:** Referencia al issue de Linear que resuelve
- **Qué se hizo:** Descripción breve de los cambios
- **Cómo testear:** Pasos para verificar que funciona
- **Screenshots/grabaciones:** Si hay cambios visuales

---

## Proof of work — obligatorio antes de abrir PR

Pegar en la descripción del PR el output de:
```bash
npm run typecheck
npm run lint
npm test
```
Sin estos tres outputs en el PR, el review no empieza.

---

## Checklist de calidad

### Tests — verificar primero
- [ ] `npm test` pasa sin errores y sin dependencias externas (sin Supabase real, sin red).
- [ ] Los nuevos tests usan mocks para Supabase y fixtures para datos. No conectan a staging.
- [ ] Si el issue introduce funcionalidad nueva, existe al menos un test que la cubre.
- [ ] Los tests E2E con Playwright corren separados de los unitarios (`npm run test:e2e`).

### Velocidad — verificar segundo
- [ ] ¿El editor sigue aislado? ¿Un keystroke no re-renderiza el sidebar ni paneles?
- [ ] ¿El auto-save guarda local primero, sync remoto en background?
- [ ] ¿Ninguna operación de AI bloquea el flujo de escritura?
- [ ] ¿No se agregaron dependencias pesadas sin justificación?
- [ ] ¿Los paneles secundarios nuevos se cargan con lazy load?
- [ ] ¿La app puede abrir y editar documentos sin conexión a red?

### Código
- [ ] TypeScript estricto. Sin `any`. Sin `@ts-ignore`.
- [ ] Sin `console.log` residuales (solo `console.error` intencionales).
- [ ] Sin código comentado. Si no se usa, se borra.
- [ ] Sin dependencias nuevas innecesarias. Si se agrega una, justificar en el PR.
- [ ] Funciones y variables con nombres descriptivos en inglés.
- [ ] Componentes pequeños, una sola responsabilidad.

### Nomenclatura semántica
- [ ] Cada módulo nuevo tiene `id`, `data-page`, `data-section`, `data-testid`
- [ ] Clases BEM en PascalCase presentes para identificación
- [ ] Nombres de componentes coinciden con su clase BEM

### Seguridad
- [ ] Sin API keys o secrets expuestos al cliente.
- [ ] RLS cubre los datos que se leen/escriben.
- [ ] Input validado con Zod en API routes.
- [ ] Autenticación verificada en rutas protegidas.
- [ ] No se opera contra producción.

### Consistencia con Odessay
- [ ] ¿Respeta la simplicidad radical? ¿No agrega UI innecesaria?
- [ ] ¿No introduce métricas visibles para el usuario?
- [ ] ¿Tipografía y spacing consistentes con `skill-design.md`?
- [ ] ¿ShadCN customizado para la marca, no con defaults?
- [ ] ¿El AI editor nunca genera texto?
- [ ] ¿Los bordes son `0.5px`? ¿Los iconos tienen `strokeWidth={1.5}`?

### Base de datos
- [ ] Migraciones versionadas y con rollback documentado.
- [ ] `odessay-modelo-datos.md` actualizado si hubo cambios de schema.
- [ ] RLS policies testeadas.
- [ ] Índices creados para queries nuevas.
- [ ] Los writings tienen `version` y `sync_status` si aplica.

### Testing
- [ ] Flujos críticos afectados tienen test E2E.
- [ ] Tests pasan en staging.
- [ ] Auto-save verificado con reload.
- [ ] Mobile: lectura funciona, escritura bloqueada.

### Documentación
- [ ] Si el cambio afecta la arquitectura, los docs están actualizados.
- [ ] Si se agrega un endpoint nuevo, está documentado.
- [ ] Si se cambia el schema, `odessay-modelo-datos.md` refleja el cambio.

---

## Red flags — Rechazar PR si:

- El editor no está aislado — keystrokes re-renderizan componentes externos.
- Auto-save va directo a Supabase sin base local primero.
- Una llamada de AI bloquea o congela el editor.
- Hay `any` en TypeScript.
- API keys expuestas al cliente.
- No hay RLS en tablas nuevas.
- No hay test para flujo crítico nuevo.
- El AI editor genera texto en algún caso.
- Se agregó UI que el issue no pedía.
- Se agregaron dependencias pesadas sin justificación.
- No hay descripción del PR o no referencia el issue.
- Se operó contra producción.

---

## Protocolo del agente revisor

Este protocolo aplica cuando un agente es invocado desde Linear usando **"Open in Claude Code"** sobre un issue en estado **In Review**. El agente no es el implementador — es el revisor. Su trabajo es verificar y aprobar, no modificar código.

### Identificar el rol antes de empezar

Antes de hacer cualquier cosa, el agente debe leer el estado del issue en Linear. Si el issue está en **In Review**, este protocolo aplica. Si está en **In Progress** o **Todo**, aplica el protocolo de implementación (SETUP.md + CLAUDE.md).

### Checklist de revisión — en orden

**1. Proof of work presente**
- ¿El PR incluye output de `npm run typecheck`? ¿Sin errores?
- ¿El PR incluye output de `npm run lint`? ¿Sin errores?
- ¿El PR incluye output de `npm test`? ¿Sin errores?

Si falta alguno de los tres → **rechazar**. No hay nada que revisar sin proof of work.

**2. Trazabilidad Linear ↔ GitHub**
- ¿El issue en Linear tiene un comentario del agente implementador con: link al PR + commit SHA + resultado de validaciones?
- ¿El PR referencia el issue (ej. `feat(setup): init Next.js baseline [ODE-10]`)?

Si falta el comentario de trazabilidad → **rechazar**. La conexión Linear ↔ GitHub es obligatoria.

**3. Archivos modificados vs. ## Files affected**
- Comparar los archivos tocados en el PR contra la sección `## Files affected` del issue.
- Si hay archivos modificados que no estaban en `## Files affected` → evaluar si el cambio es scope creep o una adición justificada.
- Si hay archivos listados en `## Files affected` que no fueron modificados → verificar si el issue quedó incompleto.

**4. Red flags del checklist**
- Revisar la lista de Red flags de este skill contra los cambios del PR.
- Si se detecta alguno → **rechazar** con descripción del problema específico.

**5. status.json actualizado**
- ¿Se agregó una entrada en `docs/ops/status.json → built` con el issue ID, commit SHA y fecha?
- Si el issue era el último de la fase activa → ¿se actualizó `active_phase`?

### Decisión final

**Si todos los checks pasan:**
```
✅ REVIEW APROBADO

Issue: [ODE-XX]
PR: [link]
Commit: [SHA]
Validaciones: typecheck ✅ | lint ✅ | tests ✅
Trazabilidad: comentario en Linear ✅ | status.json actualizado ✅

Acción: aprobación técnica completa. Pendiente merge humano.
```
Con REVIEW APROBADO, ejecutar en este orden:

→ Usar Linear MCP (`save_comment`) para postear el texto anterior como comentario en el issue.
→ Esperar confirmación de merge por parte del humano (o instrucción explícita de merge por CLI).
→ Cuando el PR esté mergeado, mover el issue a Done en Linear.

Sin merge confirmado, el issue se mantiene en `In Review`.

**Si algún check falla:**
```
⛔ REVIEW RECHAZADO

Issue: [ODE-XX]
Problema: [descripción exacta del problema]
Acción requerida: [qué debe corregir el agente implementador]

El issue vuelve a In Progress hasta que se corrija.
```
→ Comentar en el issue de Linear con el formato anterior.
→ No hacer merge. Mover issue de `In Review` → `In Progress`.
→ No modificar el código — el agente revisor no implementa.

### Lo que el agente revisor NO hace

- No modifica código para corregir errores.
- No hace commits al branch del PR.
- No aprueba PRs que no tienen proof of work completo.
- No hace merge por defecto sin instrucción explícita del humano.
- No hace merge si hay red flags activos.
- No evalúa si el código "se ve bien" — solo verifica que las condiciones objetivas se cumplan.
