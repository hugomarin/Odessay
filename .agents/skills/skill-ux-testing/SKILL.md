---
name: skill-ux-testing
description: Valida flujos de usuario y criterios de aceptación mediante recorridos observables y pruebas al nivel necesario para detectar regresiones.
---

# UX Testing

## 1. Objetivo

UX Testing comprueba que una persona puede completar un flujo y observar el resultado prometido. Traduce criterios de aceptación en recorridos, estados y evidencia reproducible.

Pregunta guía: **¿Puede el usuario completar el objetivo y reconocer qué ocurrió en éxito, espera y error?**

## 2. Ámbito y activación

Aplicar cuando un cambio altera interacción, navegación, presentación de contenido, accesibilidad, responsive o un flujo crítico. Elegir E2E cuando el riesgo depende de la integración entre superficies; elegir una prueba más cercana al owner cuando falsifica el mismo fallo con menor costo.

## 3. Entradas y fuentes de autoridad

Reunir intención del usuario, criterios de aceptación, rutas y estados reales, contratos de diseño, datos de prueba y comportamiento previo. El proyecto define flujos críticos, superficies equivalentes, entorno y herramientas disponibles.

## 4. Método y criterios

1. Formular la tarea que la persona intenta completar y el punto donde empieza.
2. Recorrer cada paso con datos representativos; comprobar que las acciones y consecuencias se entienden sin instrucciones adicionales.
3. Observar carga, vacío, error, retry y finalización. Verificar que los estados transitorios terminan.
4. Comparar superficies que prometen presentar el mismo contenido o capacidad; declarar las dimensiones exactas de paridad.
5. Elegir una prueba que reproduzca la integración relevante y espere el evento que establece el resultado, no solo el inicio de la operación.
6. Reutilizar fixtures y helpers del harness existente; documentar cualquier precondición que el test necesita.
7. Registrar evidencia del flujo y del entorno en que se ejecutó.

## 5. Resultado y evidencia

Entregar un veredicto por criterio de aceptación, con pasos, resultado observado, entorno y prueba o captura relevante. Un fallo identifica dónde se rompe el flujo y qué observa la persona usuaria.

## 6. Manejo de fallos e incertidumbre

Si falta un criterio de aceptación material, formular la pregunta específica y el escenario que depende de ella. Un test que pasa con mocks inverosímiles, sin esperar finalización o en otro runtime no acredita el flujo prometido. Escalar al contrato de producto cuando dos superficies tienen expectativas incompatibles.

## 7. Relaciones y ownership

Planning define el resultado aceptable; Design y Frontend poseen presentación e interacción; Backend y Database poseen sus operaciones; Performance define arquitectura de carga. UX Testing valida la consecuencia observable del conjunto.

## 8. Recursos asociados

- **Especialidad local:** en Odessay, [specialties/critical-user-flows.md](specialties/critical-user-flows.md) conserva flujos críticos, rutas, paridad textual, Playwright, AI Editor y mobile. Cargar las secciones activadas por el cambio.
- **Mecanismos:** usar el browser y harness de pruebas que el repo tenga configurados.
