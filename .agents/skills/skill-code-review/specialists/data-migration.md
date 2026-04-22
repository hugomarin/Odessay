# Specialist: Data Migration Review

Checklist especializado para revisar migraciones de base de datos. Aplicar contra el diff.

---

## Migración versionada

- [ ] ¿Nombre sigue formato `{timestamp}_{descripcion}.sql`?
- [ ] ¿Es una transacción (`BEGIN; ... COMMIT;`)?
- [ ] ¿Incluye rollback documentado como comentario al final?

## Schema integrity

- [ ] ¿`odessay-modelo-datos.md` actualizado si hubo cambios de schema?
- [ ] ¿Types de Supabase regenerados (`supabase gen types typescript`)?
- [ ] ¿No se modificó migración ya aplicada?

## RLS y permisos

- [ ] ¿RLS activo en tabla nueva?
- [ ] ¿Policies creadas para private/shared/public?
- [ ] ¿Trigger necesario creado (ej: `on_auth_user_created`)?

## Datos existentes

- [ ] ¿Si agrega columna NOT NULL, tiene default o migración de datos?
- [ ] ¿Si renombra columna, ninguna query en código usa el nombre viejo?
- [ ] ¿Índices creados para queries nuevas?

## Output esperado

Output: SOLO líneas JSON. Nada de texto libre, markdown, headers o comentarios.

Para cada finding:
```json
{"severity":"CRITICAL|HIGH|MEDIUM|LOW","confidence":N,"path":"file","line":N,"category":"migration/{categoria}","summary":"{descripción}","fix":"{recomendación}","specialist":"data-migration"}
```

Categorías: `missing-rollback`, `missing-rls`, `missing-index`, `schema-drift`, `breaking-change`, `data-loss-risk`

Si no hay findings: output `NO FINDINGS` y nada más.
Do not output anything else — no preamble, no summary, no commentary, no markdown blocks.
Output ONLY raw JSON lines. No prose.
