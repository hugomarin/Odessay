# Specialist: Security Review

Checklist especializado para revisar seguridad. Aplicar contra el diff.

---

## OWASP Top 10 — chequeos rápidos

### A01: Broken Access Control
- [ ] ¿Nuevo endpoint verifica `auth.uid()` o equivalente?
- [ ] ¿Se puede acceder a recursos de otro usuario cambiando IDs en params/body?
- [ ] ¿RLS cubre la nueva tabla/columna?

### A02: Cryptographic Failures
- [ ] ¿Ningún secret hardcodeado en el diff?
- [ ] ¿Variables de entorno sensibles usan `process.env` (no `NEXT_PUBLIC_`)?

### A03: Injection
- [ ] ¿SQL raw o string interpolation en queries a Supabase?
- [ ] ¿User input llega a system prompts de Claude sin sanitización?
- [ ] ¿Se usa `eval()`, `new Function()`, o `dangerouslySetInnerHTML` con contenido dinámico?

### A07: Identity and Auth
- [ ] ¿Nueva ruta API protegida por middleware de auth?
- [ ] ¿Sesión verificada server-side con `createServerClient`?

## AI / LLM Security (específico de Odessay)

- [ ] ¿El AI editor nunca genera texto en la respuesta? (debe ser observación/silencio)
- [ ] ¿Las respuestas de Claude se renderizan como texto plano, nunca como HTML?
- [ ] ¿Hay rate limiting en endpoints de AI?
- [ ] ¿Los system prompts no interpolan user input directamente?

## Supabase específico

- [ ] ¿RLS activo en tabla nueva?
- [ ] ¿Policy de `auth.uid() = author_id` donde aplica?
- [ ] ¿No se usa `service_role` key desde el cliente?
- [ ] ¿Migración no expone datos de producción?

## Output esperado

Output: SOLO líneas JSON. Nada de texto libre, markdown, headers o comentarios.

Para cada finding:
```json
{"severity":"CRITICAL|HIGH|MEDIUM|LOW","confidence":N,"path":"file","line":N,"category":"security/{categoria}","summary":"{descripción}","fix":"{recomendación}","specialist":"security"}
```

Categorías: `rls-bypass`, `auth-missing`, `secret-exposure`, `sql-injection`, `prompt-injection`, `ai-output-trust`

Si no hay findings: output `NO FINDINGS` y nada más.
Do not output anything else — no preamble, no summary, no commentary, no markdown blocks.
Output ONLY raw JSON lines. No prose.
