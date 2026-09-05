# ODESSAY — Fase 10 Definition of Done (DoD)

Este documento define el gate de cierre de **Fase 10 — Artifact Studio: la superficie**.
Si un punto no está cumplido, el rediseño no se considera terminado, aunque las vistas "se vean bien".

Fase 9 unificó el modelo documental desktop: un catálogo, un binding, una apertura. Fase 10 no lo toca. Fase 10 cambia lo que el usuario ve y cómo se nombra el producto: dos capas visuales explícitas (producto y marketing), un shell de dos capas, un inventario cerrado de overlays, una marca regenerada y un solo vocabulario — **artifact**.

El paquete de diseño aprobado vive en `docs/design/` (originado en `handoff-artifact-studio-handsoff/`). Los prototipos `.dc.html` son referencia visual, nunca código a copiar.

Referencias:

- `docs/design/migration-plan.md` — fases, gates y riesgos del rediseño.
- `docs/design/system-app.md` — capa de producto: tokens, tipo, geometría, shell, motion.
- `docs/design/layout.md` — escala de espaciado, ownership de regiones, grids por vista, breakpoints.
- `docs/design/overlays.md` — inventario cerrado de modales, dropdowns y barras.
- `docs/design/icons.md` — el único listado de iconos del que un implementador puede elegir.
- `docs/design/brand.md` + `docs/design/views/*.md`
- `.agents/skills/skill-design/SKILL.md`, `.agents/skills/skill-design/vistas.md`, `.agents/skills/skill-design/tipografia.md`
- `.agents/skills/skill-design-landing/SKILL.md` + `design.md`
- `AGENTS.md` / `workflow/agents.md` — guardrails de arquitectura documental, no negociables en esta fase.
- `workflow/define/roadmap.md`

---

## 1) La fase no cambia la arquitectura documental

- Ninguna vista rediseñada descubre documentos por una fuente paralela: todo lee del `DocumentCatalog` vigente.
- No se introduce ningún store durable nuevo. La regla *Ignore* del flujo add-workspace **no se implementa**: se envía únicamente selección por checkbox + "Only this" (decisión del dueño, 2026-08-14).
- Los invariantes de `workflow/agents.md` (contenido, binding, catálogo, nube, reconciliación, superficies, apertura, guardado, boundaries, errores) siguen verdaderos al cierre, evidenciados por las suites existentes en verde.
- Cualquier contradicción entre el paquete de diseño y esos invariantes se resuelve a favor del invariante y se registra como `Context Gap`, no se promedia.

## 2) Existen dos capas visuales y no se contaminan

- La capa de producto (`(app)`, `(auth)`, `(reading)`) y la capa de marketing (`(marketing)`) están separadas por scope de tokens: `[data-layer="marketing"]`.
- Newsreader se carga únicamente en el layout del grupo de marketing. En cualquier ruta de app, `document.fonts.check('200 44px Newsreader')` es `false`; en la home es `true`.
- Ningún archivo bajo `components/marketing/` usa `shadow-float*`, `bg-card`, `bg-sb`, `text-ink-*` ni radios de app (8/10/12); ningún archivo de app usa tokens `--mkt-*`. Ambas direcciones se verifican por grep en REVIEW.
- La regla `body { @apply bg-bg text-ink }` no se modifica; el wrapper de marketing pinta su propio fondo.
- Las dos skills de diseño coexisten sin ambigüedad: `skill-design` es autoridad de producto, `skill-design-landing` de marketing, y ningún valor vive en ambas sin estar marcado.

## 3) El sistema de producto tiene una sola definición

- Los cinco deltas del handoff están resueltos **en la skill**, no solo en el código: neutrales/hairlines nuevos (`--ink-5`, `--line-soft`, `--surface-selected`), DM Sans como fuente de UI con Geist reservado al wordmark, tamaño del cuerpo del editor decidido entre 17/1.9 y 18/1.85, bordes 0.5px, y vocabulario "artifact".
- No queda ningún hex literal del paquete de diseño hardcodeado en componentes: todo pasa por token.
- Los valores que el diseño define como exactos —`clamp()`, porcentajes de crop, coordenadas del mapa— se copian literalmente; no se aproximan.
- Todo valor de layout está en la escala de espaciado declarada. Ningún componente nuevo introduce un radio fuera de `6 · 7–8 · 9 · 10 · 13–14 · 18 · 50%`.
- Los iconos usados existen en `docs/design/icons.md`, son Lucide y respetan `strokeWidth 1.5` salvo las excepciones declaradas.

## 4) El shell de dos capas es un invariante observable

- Layer 0 (shell) contiene titlebar, rail y paneles; layer 1 (la hoja) contiene el contenido y todo lo que lo acompaña — header, toolbar, footer, empty state.
- Rail y paneles no tienen fondo propio. Hay exactamente una superficie elevada por vista; los overlays son la excepción y oscurecen el shell.
- Titlebar y status bar abarcan la ventana completa; header y toolbar nunca.
- El rail colapsa y expande sin que el icono cambie de posición X, en 300ms `cubic-bezier(.4,0,.15,1)`.
- Los breakpoints declarados (1440 / 1100 / 900 / 700) degradan paneles y columnas en el orden especificado, sin scroll horizontal del cuerpo.

## 5) Los overlays son un inventario cerrado

- Existen exactamente cinco patrones: flow modal, form modal, display modal, full overlay y dropdown/popover. Ningún overlay nuevo se inventa fuera de ellos.
- Cada overlay entra con `odModalIn` 260ms, cierra con `Esc`, atrapa el foco y lo devuelve al disparador, bloquea el scroll del cuerpo y cierra por scrim salvo con campos sucios (entonces confirma).
- Nunca hay dos overlays simultáneos: un dropdown dentro de un modal es válido; un modal desde un modal se convierte en paso.
- Las acciones destructivas son texto terracota en hover, nunca relleno rojo, y su copy nombra el objeto ("Delete artifact"), nunca "OK".
- La barra de selección de Desk y la de Archived artifacts son **el mismo componente**, y mientras está visible la hoja recibe 96px de padding inferior.

## 5-bis) El prototipo es la autoridad visual, y se demuestra

- Los prototipos `.dc.html` viven en `docs/design/reference/` y abren en un navegador desde el repo. Son la **autoridad visual** de la fase; los documentos de `docs/design/views/` son una lectura en prosa de esas decisiones, no el inventario completo de valores del render.
- Precedencia declarada y aplicada: donde la prosa calla, el valor se lee del prototipo; donde prosa y prototipo difieren, gana el prototipo; `skill-design` y los tokens gobiernan **cómo se expresa** ese valor, no la geometría.
- Ningún valor visual entregado en la fase se infirió del resto de la app ni se eligió por criterio propio: **lo que el prototipo no define es una pregunta al dueño del diseño, no una invención**.
- Cada vista rediseñada tiene comparación lado a lado contra su prototipo, por región, al mismo ancho de viewport.
- Toda divergencia respecto al prototipo está **registrada y aceptada** en una tabla única — vista, región, qué difiere, por qué, quién lo aceptó. Las únicas desviaciones autorizadas de antemano son: la supresión del control *Ignore* en el flujo add-workspace, el envío del copy en inglés donde el prototipo estaba en español, y las reglas de traducción declaradas (tokens en vez de hex, 0.5px en vez de 1px).

## 6) Cada vista cumple su especificación y su checklist

- Desk, Studio, Workspace (índice y detalle), Add workspace, Settings, Auth/Splash y los tres estados vacíos cumplen los valores exactos de su documento en `docs/design/views/`.
- Los checklists por vista de esos documentos se ejecutan y se adjuntan como evidencia; un checklist sin correr es un requisito sin cumplir.
- Las acciones de fila son alcanzables por teclado, no solo por hover. Los estados vacíos conservan header y rail: el usuario nunca pierde la navegación.
- Los colores de tipo y estado provienen siempre de la configuración del usuario; cambiarlos repinta badges en Desk, editor y preview sin recargar.
- El copy de las superficies destructivas (Disconnect, Delete account) declara explícitamente que los archivos locales quedan intactos.
- Studio se interviene en presentación: `editor-shell.tsx` es punto de integración, no reescritura, y las pruebas existentes del editor siguen verdes.

## 6-bis) Los tipos y estados son vocabulario del usuario, no listas cerradas

Este bloque financia lo que §6 ya afirmaba —*"los colores de tipo y estado provienen siempre de la configuración del usuario"*— y que hasta `ODE-472`..`ODE-477` no tenía dónde persistir. `ODE-432` entregó la superficie de Settings apagada a propósito y lo declaró en el código; este bloque la enciende.

- El usuario crea, renombra, recolorea y reicona tipos de artifact y estados de escritura desde Settings, y esos cambios existen en un solo modelo de persistencia y un solo servicio, compartidos por web y desktop.
- Los tipos base y el estado `Draft` conservan sus protecciones: se pueden editar, no borrar; `Draft` además no se puede ocultar.
- Ocultar un estado lo saca de menús y filtros y **no** modifica ningún artifact existente. Borrar un item personalizado sí reescribe al valor base (`General` / `Draft`) los artifacts que lo usaban, siempre tras una confirmación que nombra cuántos son — decisión del dueño, 2026-08-30.
- El vocabulario es local-first en desktop: existe sin sesión iniciada, con los tipos y estados actuales como default sin conexión, y se reconcilia con la nube al autenticar según una regla escrita y determinista.
- Ningún componente conserva una versión local del catálogo. `lib/writings/status-color.ts` y `lib/writings/artifact-type-color.ts` dejan de existir y no queda ningún `switch` sobre valores de vocabulario en `components/`; se verifica por grep en REVIEW, igual que los tokens prohibidos.
- Un valor que ya no está en el catálogo se **preserva**, nunca se coerciona en silencio: la coerción actual de `normalizeWritingStatus` y `normalizeArtifactType` a `draft`/`general` desaparece.
- Un cambio de nombre, icono o color repinta Desk, Studio, Workspace, filtros, badges y preview sin recargar, y sobrevive al reinicio y a la rehidratación.
- Ninguna de estas operaciones escribe metadata en el frontmatter ni altera el contenido de un `.md`, demostrado por comparación de hash del archivo antes y después.
- La asistencia AI del modal ("Recommend to me", "Improve with AI") queda fuera del alcance de la fase y permanece deshabilitada con su razón visible — decisión del dueño, 2026-08-30.

**Trazabilidad (`ODE-477`).** Cada afirmación de este bloque queda enlazada
a su prueba (test automatizado, prueba manual reproducible, o pendiente de
aceptación del dueño) en `artifacts/ode-477/evidence-matrix.md`. Resumen: las
afirmaciones de no-escritura en frontmatter, ocultar-vs-borrar, y
preservación de valores desconocidos están probadas por test automatizado;
la paridad web/desktop está probada por contrato compartido + tests
espejados pero no por una sesión en vivo lado a lado; la persistencia a
través de reinicio/rehidratación y las capturas de aceptación por superficie
**no** se produjeron en el entorno de este agente (sin sesión autenticada ni
build de escritorio disponible) y quedan pendientes de una pasada humana —
ver el propio archivo de evidencia para el detalle y los pasos que faltan.

## 7) El vocabulario y la marca son uno solo

- Toda la UI dice **artifact**, en inglés, en producto y en landing. No quedan restos de "writing"/"document" en copy visible al usuario; los nombres de archivo y símbolos se migran en un pase mecánico separado y declarado.
- Ninguna superficie mezcla idiomas: el prototipo era bilingüe, el producto enviado es inglés.
- La marca es una sola geometría (tres hojas, offsets 0/0.4/0.8, sin gradiente ni versión de contorno), con wordmark en Geist 500 y sin tagline anclado.
- App icon, favicon y `src-tauri/icons/*` se regeneran desde el SVG aprobado; bajo 20px la marca cae a dos hojas.

## 8) La landing existe y argumenta en el orden correcto

- `app/(marketing)` contiene las once secciones en el orden especificado: el problema va **antes** de la solución.
- El mapa del flujo roto conserva su `viewBox`, sus siete paradas en porcentajes y sus rutas sólidas/punteadas; ningún chip se solapa a 1320, 1100 ni 960px, y el rail de contraste no envuelve.
- Las capturas son PNGs reales del build, recortadas en porcentajes, servidas por `next/image`, sin CLS, y con un README que nombra vista y fecha para poder regenerarlas.
- Todo `ArrowLink` cae en una línea a 1320, 1100 y 900px. El oro aparece como máximo tres veces por pantalla y hay un solo panel crema por vista.
- La home migra a `app/(marketing)/page.tsx` conservando `DesktopStartupRedirect` como primer hijo; el desktop sigue redirigiendo al arranque de la app y `/login` y `/signup` no cambian.
- Las decisiones abiertas del dueño (destinos de nav, testimonios, tarjeta de version history, destinos de los CTA) quedan resueltas por escrito antes del cierre, no inferidas.

## 9) Performance y no-regresión están evidenciados

- Ninguna ruta de app carga una capa de fuente adicional por culpa del marketing; se verifica en el panel de red de `/desk`.
- Las vistas rediseñadas conservan sus presupuestos: latencia de interacción en Studio, tiempo a interactivo en Desk/Workspace, y peso/waterfall donde el issue toque `page.tsx` o rutas de lista.
- Las capturas de una ruta de app no modificada antes/después prueban que ningún issue de marketing movió un píxel del producto.
- Typecheck, lint, Vitest, tests de Rust cuando apliquen, `validate-workflow-json` y `ops:delivery:gate` en verde en cada entrega.

## 10) Evidencia de aceptación

- Por issue, en `artifacts/<issue>/`: capturas a 1440 / 1100 / 768 de cada vista cambiada, capturas antes/después de una ruta de app no tocada, output del grep de tokens prohibidos, y para issues de marketing el resultado de `document.fonts.check`.
- Para el flujo add-workspace: el árbol de inclusión visible con ≥4 filas a 540, 700 y 860px de alto de viewport.
- Matriz trazable desde cada bloque de este DoD a un test, una prueba manual reproducible o la aceptación explícita del dueño.
- Cada issue con comportamiento visible cierra con **demo de outcome aceptado por el dueño**, no solo con proof of work verde.

## Gate de cierre de fase

Fase 10 se marca `Done` solo si los diez bloques anteriores están evidenciados, no quedan issues bloqueantes abiertos en el proyecto Linear de Fase 10, el paquete de diseño en `docs/design/` describe exactamente lo enviado, y `skill-design` + `skill-design-landing` son la única fuente de verdad visual del repositorio.
