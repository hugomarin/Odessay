# Contratos de review de Odessay

Este recurso vincula las referencias de arquitectura, corrección, testing y tamaño del cambio de Code Review con contratos y mecanismos de Odessay. Cada lente conserva su pregunta y criterio; `.agents/agents/review-agent.md` orquesta su uso y `skill-code-review/scoring.md` posee el formato y la puntuación de findings.

## Baseline del review de Odessay

El orquestador `skill-code-review` comprueba rápidamente: TypeScript estricto (`any`/`@ts-ignore` nuevos), logs residuales, código comentado, dependencias nuevas justificadas, nombres descriptivos en inglés, nomenclatura semántica (`id`, `data-page`, `data-section`, `data-testid`) y clases BEM en PascalCase cuando aplican. El trabajo de desarrollo y testing usa entornos no productivos. Convertir gradualmente estas reglas sintácticas en lint/CI conserva el review para comportamiento y contratos.

En superficies visuales, consultar `skill-design`, `tipografia.md` y sus contratos de paridad: tipografía, spacing, overflow de tablas grandes (`tableWrapper`, `width:max-content`, scroll interno), ShadCN adaptado, bordes `0.5px` e iconos `strokeWidth={1.5}`. La simplicidad radical de Odessay mantiene fuera del diff UI no pedida y métricas visibles ajenas al producto.

## Architecture: contratos y runtime desktop

Activar la lente si el diff cambia ownership, contratos, fuente de verdad, runtime o boundaries, o si el brief trae `Architecture Contract`. En Odessay esto suele incluir cambios de contrato en desktop, multi-runtime, shared core, adapters, servicios, save path, sync/hydration, parser/serializer o `.md` documental. Comparar el código final con el contrato, la fuente normativa en `AGENTS.md` y `.agents/skills/skill-architecture/specialties/ownership-and-sources.md`. Un owner duplicado requiere nombrar tanto al owner canónico como a la implementación competidora; cuando no hay owner decidido, reportar `Architecture Gap`.

Revisar de forma concreta que el shared core no adquiera dependencias de Next, Supabase, cookies, `fetch`, `window` o un filesystem específico, y que la UI no orqueste save, sync o infraestructura cuando el contrato asigna esa responsabilidad a Application o Adapter.

Para schema, RLS y migraciones, la lente comprueba coherencia con el owner y runtime declarados; `.agents/skills/skill-code-review/specialists/data-migration.md` conserva el checklist detallado.

### Bundle desktop

Si el diff toca `src-tauri/`, `lib/runtime/`, `lib/supabase/desktop-client.ts`, servicios desktop, `lib/auth/secure-storage.ts`, páginas con auth server de `app/(app)/**` o `scripts/prepare-tauri-build.mjs`, verificar el artefacto de producción además del entorno dev. Fuentes: `workflow/context/features/odessay-desktop-migration-diagnostic.md` (§Diferencias entre tauri dev y tauri build) y `workflow/context/features/odessay-desktop-target-architecture.md` (§Storage de tokens).

- CSP del bundle admite `ipc:` y `http://ipc.localhost` en `connect-src`; de lo contrario, `invoke()` puede devolver `null` sin lanzar error y la consola muestra el rechazo de `ipc://localhost`.
- El cliente Supabase desktop usa `createClient` de `@supabase/supabase-js` y conserva el storage de sesión nativo. `createBrowserClient` de `@supabase/ssr` impone cookies, que no persisten en el custom protocol del DMG, aun con `auth.storage` custom.
- `keyring` declara backend nativo, en macOS `features = ["apple-native"]`; con `features = []` puede compilar usando un mock en memoria que acepta el write y pierde el valor en el read.
- Cada página nueva con `redirect("/login")` server-side contempla `isTauriBuild`; de otro modo el redirect puede quedar baked en el RSC payload del static export y redirigir aun con sesión.
- DevTools permanece disponible en el bundle mientras la distribución ad-hoc lo necesite para diagnosticar auth, IPC y CSP; sin consola, esos fallos pueden quedar indiagnosticables.
- La evidencia del DMG real cubre signin, ruta interna, cierre, reapertura y sesión preservada.

El fallo de un check aplicable al bundle bloquea aprobación según la política de review del proyecto. El éxito en `tauri dev` solo acredita el entorno dev.

### Coherencia por scope

- AI corrections/streaming/memoria: `workflow/context/features/odessay-ai-writing-assist.md` y `skill-corrections`.
- TipTap/ProseMirror/decorations/parser: `workflow/context/features/odessay-prosemirror-tiptap.md`.
- Desktop/shared core/save/sync/servicios: routing de `AGENTS.md` al ADR, catálogo y documentos desktop que el brief activa.

La navegación interna de tabs, filtros y paneles es estado de vista local-first. Si un diff la convierte en rutas mediante `router.push()`, dispara `?_rsc=` para datos disponibles en `localDB` o crea destinos para estado interno, confrontarlo con `workflow/context/features/odessay-sync.md` y `workflow/context/core/odessay-arquitectura.md`. Un cambio de UI fuera del issue se juzga contra el alcance del brief. Si el issue requería `Architecture Contract` y este falta, está incompleto o el diff lo contradice, bloquear aprobación. Si el código final contradice un documento normativo del scope sin actualizarlo, bloquear aprobación por desalineación de contrato. La severidad de una ruptura de boundary se fija por su propagación real, usualmente P0/P1.

## Correctness: invariantes de experiencia y AI

La inmediatez del editor es comportamiento de producto: un keystroke mantiene aislado el editor; auto-save confirma local antes del round-trip remoto; AI no congela escritura; la edición local funciona sin red; paneles secundarios respetan su estrategia de carga. Una regresión que rompe uno de estos caminos se reporta como corrección con su secuencia concreta y se coordina con `skill-performance`.

En AI, `observe/discuss` del editor residente conservan su contrato de silencio autoral, mientras writing assist devuelve sugerencias para aceptar/rechazar. Para correcciones, `skill-corrections` fija identidad, admisión, matching y estados. La lente comprueba que los entrypoints del cambio respeten esas reglas.

Para una regla de filtrado o admisión, recorrer cache, hidratación, streaming y cualquier otro entrypoint que entregue el dato a la UI; aplicar la regla en un solo camino deja resultados contradictorios.

## Testing: evidencia del camino de producción

`workflow/testing/critical-capabilities-testing.md` posee el criterio de probar al nivel de menor costo capaz de falsificar el fallo. Si el diff modifica una fila de `workflow/quality/capability-integration-map.md`, aplicar `workflow/quality/capability-proof-contract.md`: reproducir las transiciones reales hacia el estado inicial, comprobar que los doubles soportan las llamadas de producción y afirmar completion después del evento que establece el invariante. El checklist de pre-upgrade gobierna cualquier subida de `coverage_status`.

Los tests usan fixtures y mocks para Supabase; los E2E corren separados de los unitarios (`npm run test:e2e`). Para auto-save, comprobar durabilidad tras reload. En mobile, comprobar lectura y bloqueo de escritura cuando aplica. `.agents/skills/skill-code-review/specialists/testing.md` adapta esta lente a un worker con JSON estricto; el criterio técnico vive en `references/testing.md`.

## Change Size: umbral y formato

En Odessay, más de unas 150–200 líneas cambiadas sin justificación de unidad, mezcla de dominios o comportamiento oculto por rename masivo activan la lente. El umbral sirve para decidir mirar el diff, no para condenarlo. Una extracción coherente desde un hotspot puede tocar muchos archivos en una sola etapa.

El finding de división nombra las unidades y el `smallest coherent stage`. Suele ser P2/P3; se eleva a P1 cuando el tamaño oculta un riesgo material no revisado. `skill-code-review/claude-enhancements.md` usa `DIFF_LINES` para costo de dispatch de especialistas, una decisión distinta de revisabilidad.
