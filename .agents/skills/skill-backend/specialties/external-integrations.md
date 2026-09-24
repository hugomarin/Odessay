# Integraciones externas de Odessay

Este recurso describe decisiones y convenciones vigentes de Odessay para [Backend](../SKILL.md). AGENTS.md y los contratos aceptados conservan la precedencia normativa.

## AI Provider Integration — Reglas obligatorias antes de implementar

### Paso 0: leer la documentación del proveedor

**Antes de implementar cualquier feature que use un proveedor AI** (Fireworks, Anthropic, OpenAI u otro), leer la documentación oficial del proveedor para el modo de salida que se va a usar:

- `json_schema` / structured outputs: ¿es compatible con streaming? ¿con el modelo configurado? ¿qué pasa si el proveedor rechaza el schema?
- `json_object`: ¿garantiza forma o solo un objeto válido? ¿puede devolver prose pese al mode?
- `stream: true` + structured output: ¿el proveedor emite `delta.content` o solo el objeto final? ¿está documentado el comportamiento de chunks vacíos?
- Límites del modelo: ¿cuál es el context window? ¿cuál es el máximo de output tokens permitido?

**No asumir que Fireworks se comporta como OpenAI** — el mismo parámetro puede tener comportamiento diferente entre proveedores y modelos.

### Presupuesto de tokens (obligatorio para endpoints de salida estructurada)

Antes de fijar `max_tokens` en cualquier llamada que devuelva JSON estructurado:

1. Estimar el peor caso de output: texto largo (≥300 palabras) × correcciones densas × schema con todos los campos llenos.
2. Calcular cuántos tokens ocupa ese JSON serializado (regla práctica: ~1 token ≈ 4 caracteres de ASCII/UTF-8 común).
3. Fijar `max_tokens` con margen razonable sobre ese peor caso. **El mínimo para cualquier respuesta de correcciones es 4096.** Si el texto puede crecer más, escalar proporcionalmente.
4. Si el provider-config tiene un `maxTokens` global bajo, usar `Math.max(config.maxTokens, ENDPOINT_MIN_TOKENS)` en la ruta específica — o corregir el default en `provider-config.ts`.

**Síntoma de presupuesto insuficiente:** JSON truncado a mitad del objeto → el parser siempre falla → retry loop → latencia alta → perf gate falla en CI. El origen real es el token budget, no el retry path.

### Prueba con proveedor real antes de BUILD submission

Los tests unitarios y mocks validan code paths. No validan el comportamiento del proveedor.

**Para issues que tocan rutas AI:** hacer QA manual con el proveedor real configurado en `.env.local` con textos de distintos tamaños (texto corto, texto ≥300 palabras) antes de abrir el PR. Si el proveedor devuelve prose en lugar de JSON, o streams vacíos, eso debe estar resuelto en el diff — no descubierto en review.

### Streaming sobre contrato de objeto JSON completo

Si el provider devuelve un único objeto JSON (no NDJSON ni tool-call events), **no asumir streaming real de items**. El objeto JSON parcial es inválido hasta que llega el `}` final. La arquitectura correcta:

1. Llamar al proveedor con structured output no-stream.
2. Parsear y validar una vez que llega la respuesta completa.
3. Emitir NDJSON propio desde la app al cliente a partir del JSON validado.
4. Introducir streaming real del proveedor solo si el contrato del modelo emite items incrementales (tool-call stream, function-call stream).

---

## AI Provider API (AI Editor / Writing Assist)

- Todas las llamadas AI son server-side. Nunca expongas keys al cliente.
- Dos endpoints:
  - `/api/ai/observe` — Observaciones automáticas en pausas de escritura. Recibe body del writing + instrucciones de contexto.
  - `/api/ai/discuss` — Invocación directa y discusión. Recibe body + pregunta/instrucción del autor + historial de la conversación en sesión.
- El system prompt base está en `odessay-ai-editor.md`. No lo modifiques sin revisar ese documento.
- Para endpoints del **AI editor residente** (`/api/ai/observe`, `/api/ai/discuss`): incluir instrucción de no generar texto y parsear `SILENCIO` como no-op.
- Para endpoints de **AI writing assist** (corrections/title suggestions): seguir el contrato específico en `workflow/context/features/odessay-ai-writing-assist.md` (sí hay suggestions/replacements estructurados, nunca auto-aplicación).
- Modelo/proveedor: configurables por entorno (env). No asumir modelo fijo en código.
- Para flujo de corrections y title suggestion, seguir contrato en `workflow/context/features/odessay-ai-writing-assist.md`.

## Resend (Email)

- Templates de email en `/lib/email/`.
- Dos flujos principales: notificación de writing compartido, invitación epistolar.
- Emails simples, limpios, coherentes con la marca. No HTML pesado.
- En staging, usa dominio de testing. Verifica que los emails no lleguen a usuarios reales.

## Observabilidad

- **Sentry:** captura errores de cliente y excepciones en API routes. Requerido desde Fase 1. Sin Sentry, los errores en producción son invisibles. Configuración: `npx @sentry/wizard@latest -i nextjs`.
- **Logging estructurado:** todos los errores server-side llevan contexto (`userId`, `writingId`, operación). Sin contexto el log es inútil.

```ts
// ✓ Siempre así en API routes y sync workers
console.error('[sync:remote]', { userId, writingId, operation: 'PATCH', error: error.message })

// ✗ Nunca así
console.error('Error:', error)
```

- **Build failures:** Vercel notifica por email. No requiere configuración adicional.
