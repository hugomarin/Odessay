# Desktop runtime evidence

Esta referencia generaliza la evidencia que antes estaba documentada como una
checklist de un issue. No contiene IDs, rutas de artifacts ni criterios de una
feature específica.

## Cuándo usarla

Consultar cuando el `Performance Architecture Contract` toque Tauri,
filesystem, IPC, capabilities nativas, permisos, bootstrap desktop,
listeners del runtime o distribución.

## Reglas

- `tauri dev` y mocks del navegador sirven para desarrollo, pero no prueban el
  bundle distribuible, entitlements, App Sandbox, Hardened Runtime,
  filesystem ni permisos del sistema.
- Si el riesgo es bootstrap, waterfall, payload, requests duplicados o churn de
  listeners, capturar el escenario real autenticado y ejecutar el gate de
  red/runtime seleccionado por `instruments.md`.
- Si el riesgo es una capability nativa, repetir el flujo en el bundle o DMG
  que se entrega y registrar el resultado; no sustituirlo por una captura web.
- Separar la evidencia de arquitectura/runtime de la evidencia visual de
  Desk/Workspace. La segunda pertenece a UX o arquitectura, no a este
  instrumento.
- Redactar HAR, logs y reportes antes de adjuntarlos cuando contengan tokens,
  cookies, IDs privados o rutas locales.

## Salida mínima

El brief o review debe identificar:

- runtime probado (`web`, `tauri dev`, bundle/DMG);
- escenario real y estado de sesión;
- evidencia seleccionada y su relación con el riesgo;
- limitación conocida, si el entorno no permite probar el bundle exacto.

No se exige un HAR ni una captura de DMG si el contrato no identifica un riesgo
que esas pruebas puedan representar.
