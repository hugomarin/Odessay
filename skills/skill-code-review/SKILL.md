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

## Checklist de calidad

### Velocidad — verificar primero
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