## ODESSAY — Checklist de Validación de Fase 4

Este documento convierte el DoD de **Fase 4 — Shared Core Multi-Runtime** en un checklist operativo de validación.

No reemplaza:

- `workflow/define/dod-fase-4.md`
- los tests automáticos
- el harness de cierre de `ODE-195`

Sí responde a esta pregunta:

> ¿Qué tengo que probar al cerrar Fase 4, qué puedo validar con Playwright y qué requiere validación manual?

---

## Regla de cierre

Fase 4 solo puede marcarse `Done` si:

- todos los checks `Bloqueante` pasan
- no hay regresiones críticas abiertas en web respecto a Fase 3
- `ODE-195` deja evidencia reproducible del cierre

Si un flujo `Condicional` falla y ese flujo ya era soportado antes de Fase 4 o forma parte de una experiencia visible actual, trátalo como regresión de cierre hasta demostrar lo contrario.

---

## Cómo leer este checklist

- `Bloqueante`: debe pasar para cerrar Fase 4
- `Condicional`: validar si el flujo existe hoy en producción o si fue tocado por los cambios de la fase
- `Manual`: requiere intervención humana real
- `Playwright`: puede automatizarse razonablemente
- `Mixto`: conviene hacer smoke en Playwright y cierre real manual

---

## 1) Bloqueantes de cierre

| Área | Flujo | Severidad | Playwright | Manual | Notas |
|---|---|---|---|---|---|
| `DocumentService` | crear writing → escribir → auto-save → recargar → cerrar → reabrir | Bloqueante | Sí | Sí | Es el corazón del write-path de Fase 4. |
| `DocumentService` | renombrar writing desde flujo normal | Bloqueante | Sí | Opcional | Debe preservar persistencia y estado visible. |
| `DocumentService` | exportar writing | Bloqueante | Smoke | Sí | Playwright puede validar request/descarga; humano debe validar archivo usable. |
| `Contrato documental` | Rich mode ↔ Source mode sobre el mismo documento | Bloqueante | Sí | Sí | Debe preservar el mismo contrato para el subconjunto soportado. |
| `Contrato documental` | import/export + round-trip del perfil Markdown soportado | Bloqueante | Parcial | Sí | El caso final de round-trip conviene revisarlo manualmente. |
| `SyncService` | abrir documento y validar hydration inicial | Bloqueante | Sí | Opcional | Debe cargar sin duplicados ni estados rotos. |
| `SyncService` | cambios pendientes → sync visible → retry | Bloqueante | Sí | Sí | El estado visible debe sentirse correcto, no solo existir. |
| `SyncService` | offline → online y recuperación | Bloqueante | Parcial | Sí | Playwright puede simular parte; la confianza real conviene cerrarla manualmente. |
| `Reading surfaces` | `/write/[id]`, `/preview/[token]`, `/shared/[id]`, `/{username}/{slug}` muestran contenido coherente | Bloqueante | Sí | Sí | Validar paridad de contenido y ausencia de divergencias obvias. |
| `Reading surfaces` | tablas, `pre/code`, URLs largas, overflow, scroll interno | Bloqueante | Sí | Sí | Esto está explícitamente alineado al contract de presentación. |
| `SharingService` | crear share y abrir shared writing | Bloqueante | Sí | Sí | Debe seguir operativo en web. |
| `SharingService` | preview/test-link usable | Bloqueante | Sí | Sí | Incluye acceso real a la superficie compartida. |
| `AuthService` | login → llegar a `/desk` | Bloqueante | Sí | Sí | Flujo crítico de entrada. |
| `AuthService` | logout | Bloqueante | Sí | Opcional | Debe invalidar sesión de forma consistente. |
| `ODE-195` cierre | no-regression general sobre web actual | Bloqueante | Sí | Sí | No basta con tests unitarios; se necesita cierre reproducible. |

---

## 2) Condicionales importantes

Estos no siempre bloquean por definición abstracta de Fase 4, pero sí pueden bloquear si eran capacidades activas en web o si fueron afectadas por los cambios.

| Área | Flujo | Severidad | Playwright | Manual | Notas |
|---|---|---|---|---|---|
| `AuthService` | signup → creación de perfil → `/desk` | Condicional fuerte | Sí | Sí | Si el signup web es flujo activo, trátalo como bloqueante. |
| `AuthService` | update display name / username / password | Condicional | Sí | Sí | Si settings fue tocado, debe validarse. |
| `AuthService` | cambio de email | Condicional fuerte | Parcial | Sí | El correo real y links requieren validación humana. |
| `AIService` | title suggestions | Condicional | Sí | Sí | Playwright puede smoke; humano valida calidad y estabilidad. |
| `AIService` | publication review | Condicional | Sí | Sí | Igual que arriba. |
| `AIService` | correction hydrate/persist | Condicional fuerte | Sí | Sí | Si fue tocado por la extracción de `AIService`, no lo saltes. |
| `SharingService` | revocar share / rotar preview link / revoke preview link | Condicional | Sí | Sí | Importa especialmente si ya es flujo visible actual. |
| `Desk / collections` | listas, apertura desde desk, consistencia después de guardar | Condicional fuerte | Sí | Sí | Si write-path/sync cambió, desk también puede romperse. |
| `Collections hydration` | apertura/refresh sin duplicación de requests | Condicional fuerte | Sí | Opcional | Está dentro del alcance de `SyncService`. |

---

## 3) Manuales o mixtos por provider/dispositivo

Estos casos no deberían confiarse solo a Playwright.

| Área | Flujo | Severidad | Playwright | Manual | Notas |
|---|---|---|---|---|---|
| `Voice notes / transcripción` | grabar audio real → enviar → recibir transcript | Mixto | Smoke | Sí | Playwright puede validar UI y request; el provider real y micrófono requieren humano. |
| `Voice notes / transcripción` | error UX cuando no hay transcript o falla provider | Condicional | Sí | Sí | El error debe ser claro y no romper el flujo. |
| `Mic permissions` | permitir / negar micrófono | Manual | No confiable | Sí | Mejor probarlo con navegador real. |
| `Email flows` | recepción real de correos y links | Manual | No | Sí | Especialmente para cambio de email o auth por correo. |
| `Export final` | abrir el archivo exportado y validar contenido | Mixto | Parcial | Sí | Descargar no prueba que el archivo sea correcto. |
| `AI quality` | utilidad/consistencia de respuestas | Manual | Smoke | Sí | La calidad final no se cierra con un test E2E. |

---

## 4) Qué haría con Playwright

### Suite mínima recomendada

1. login
2. crear writing
3. escribir y esperar auto-save
4. reload y verificar persistencia
5. cerrar y reabrir
6. rename
7. abrir preview/shared/public y verificar contenido básico
8. compartir writing y abrir shared/test-link
9. validar sync-visible states básicos
10. validar Rich ↔ Source en casos soportados
11. validar tablas/code/URLs largas en superficies de lectura

### Suite ampliada recomendada

1. signup
2. account settings básicos
3. corrections hydrate/persist
4. title suggestions
5. publication review
6. collections hydration sin requests duplicados
7. smoke de transcripción con validación de UI/error

---

## 5) Qué debe hacer un humano

### Validación manual obligatoria

1. write → save → close → reopen en una sesión real
2. Rich ↔ Source con contenido representativo
3. import/export y round-trip en casos reales
4. preview/shared/public leyendo contenido real
5. login/logout y, si aplica, signup
6. share/test-link reales
7. offline/online y percepción de sync

### Validación manual muy recomendable

1. cambio de email
2. title suggestions / publication review con provider real
3. voice note + transcripción real
4. export final abierto fuera de la app

---

## 6) Matriz rápida de decisión

| Si falla esto | Qué significa |
|---|---|
| write → save → reopen | Fase 4 no puede cerrar |
| Rich ↔ Source o round-trip | Fase 4 no puede cerrar |
| hydration/sync visible con regresión | Fase 4 no puede cerrar |
| preview/shared/public divergen fuerte | Fase 4 no puede cerrar |
| login/logout roto | Fase 4 no puede cerrar |
| share/test-link roto | Fase 4 no puede cerrar |
| title suggestions o publication review rotos | revisar si el flujo es activo; puede bloquear cierre |
| voice transcription rota | si era flujo soportado y quedó regresado, trátalo como bug de cierre; si no, al menos como regresión visible a clasificar explícitamente |

---

## 7) Matriz de validación servicio-contrato

Además de validar flujos de UI, Fase 4 requiere validar que cada servicio está gobernado por un contrato operativo explícito. Un flujo de UI que pasa no garantiza que el contrato subyacente sea reproducible.

### Formato

Para cada servicio validado, se debe poder responder:

1. ¿Qué contrato operativo gobierna este servicio?
2. ¿Dónde vive documentado ese contrato?
3. ¿El código actual respeta el contrato sin reconstruirlo desde implementación?

### Matriz mínima

| Servicio | Contrato operativo | Documento canónico | Estado |
|---|---|---|---|
| `DocumentService.save()` | Write-path Lifecycle Contract (C1) | `workflow/context/features/odessay-sync.md` §Contrato de lifecycle operativo | Verificado por tests/document-service.test.ts |
| `SyncService.enqueuePush()` | Write-path Lifecycle Contract (C1) | `workflow/context/features/odessay-sync.md` §Contrato de lifecycle operativo | Verificado por tests/sync-service.test.ts |
| `AIService.hydrateCorrections()` | Write-path Lifecycle Contract (C1) | `workflow/context/features/odessay-sync.md` §Contrato de lifecycle operativo | Verificado por tests/ai-auth-services.test.ts |
| Margins sync | Margins Synchronization Contract (C4) | `workflow/context/features/odessay-margenes.md` §Contrato de sincronización | Verificado por tests/margins-*.test.ts |
| Collections assignment | Collections Assignment Contract (C5) | `workflow/context/features/odessay-collections.md` §Contrato de asignación | Verificado por tests/api/writings-collections-route.test.ts |
| Export adapter | Adapter Invariant Contract (C3) | `workflow/context/core/odessay-arquitectura.md` §Invariantes de adapter | Verificado por tests/export.test.ts |
| Todos los RPCs | Effective Schema Contract (C2) | `workflow/context/core/odessay-modelo-datos.md` §Contrato de schema efectivo | Verificado por review de SQL en PR |

### Regla

Si un servicio no tiene `contract_ref` en su metadata de test, el harness de invariantes emite `WARN`.

---

## 8) Recomendación práctica de ejecución

### Primero Playwright

1. auth básico
2. write-path
3. sync visible
4. sharing
5. reading surfaces

### Después manual

1. round-trip/import-export real
2. signup/settings/email
3. AI real
4. voice transcription
5. export final

---

## 8) Criterio para tu caso actual

Si estás viendo errores como:

- `No transcript was returned for this recording`

haz esta clasificación:

1. `¿El request sale y el UI maneja bien el error?`
   - si no: bug funcional claro
2. `¿La transcripción funcionaba antes de Fase 4 y ahora no?`
   - si sí: regresión de cierre
3. `¿Ese flujo es visible y soportado hoy para usuarios web?`
   - si sí: no deberías cerrar Fase 4 ignorándolo

Eso no significa automáticamente que `AIService` esté mal diseñado; puede ser provider, auth, payload o UX. Pero sí significa que debes clasificarlo explícitamente antes de llamar la fase `Done`.
