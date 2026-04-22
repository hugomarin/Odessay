# Specialist: Testing Review

Checklist especializado para revisar cobertura de testing. Aplicar contra el diff.

---

## Cobertura obligatoria

Para cada función/componente nuevo o modificado:

### Happy path
- [ ] ¿Existe un test que verifique el comportamiento esperado con input válido?

### Error paths
- [ ] ¿Hay test para input inválido (Zod rejection, null, undefined)?
- [ ] ¿Hay test para error de red/timeout?
- [ ] ¿Hay test para error de base de datos?
- [ ] ¿Hay test para autenticación fallida (401/403)?

### Edge cases
- [ ] ¿Empty array / empty string?
- [ ] ¿Array con 1 elemento / string con 1 carácter?
- [ ] ¿Límite de longitud (máximo input)?
- [ ] ¿Race condition posible (doble submit, operación concurrente)?

## Calidad de tests

- [ ] Los tests usan mocks para Supabase, nunca conectan a staging.
- [ ] Los tests usan fixtures, no hardcodean datos en cada test.
- [ ] Cada test es independiente (no depende del estado de otro).
- [ ] Los tests nombran qué comportamiento verifican, no qué función llaman.

## Anti-patterns de testing (rechazar si aparecen)

- `expect(x).toBeDefined()` — no prueba comportamiento.
- Test que solo verifica que no lanza error — sin assertions de resultado.
- Test que usa `setTimeout` o `sleep` sin `waitFor` de testing-library.
- Test de componente que no simula user interaction (solo render mount).

## Output esperado

Output: SOLO líneas JSON. Nada de texto libre, markdown, headers o comentarios.

Para cada gap encontrado:
```json
{"severity":"CRITICAL|HIGH|MEDIUM|LOW","confidence":N,"path":"file","line":N,"category":"test-gap","summary":"{función} no tiene test para {escenario}","fix":"Agregar test en {archivo-test} que cubra {escenario}","specialist":"testing"}
```

Si no hay findings: output `NO FINDINGS` y nada más.
Do not output anything else — no preamble, no summary, no commentary, no markdown blocks.
Output ONLY raw JSON lines. No prose.
