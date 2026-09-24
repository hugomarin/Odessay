---
name: skill-frontend
description: Diseña e implementa interfaces con owners de estado claros, transiciones completas y componentes accesibles; activa guías del stack y contratos visuales del proyecto cuando aplican.
---

# Frontend

## 1. Objetivo

Frontend convierte un contrato de interfaz en componentes, estado e interacciones que preservan el comportamiento esperado. Identifica quién posee cada transición, qué datos necesita cada superficie y cómo se presenta éxito, espera y error.

Pregunta guía: **¿Cómo se construye esta interacción sin duplicar estado, autoridad ni trabajo en el camino crítico?**

## 2. Ámbito y activación

Aplicar al decidir estructura de componentes, estado, navegación, interacción, presentación de datos, editor, accesibilidad o responsive. Cargar la especialidad tecnológica cuando el repo use sus runtimes y librerías; cargar el sistema visual local cuando haya decisiones de color, tipografía, espacio o componentes.

Un cambio que mueve fuentes de verdad, contratos de servicio o límites entre runtimes también requiere Architecture antes de fijar la implementación.

## 3. Entradas y fuentes de autoridad

Reunir el brief, los flujos afectados, consumidores, owners existentes, instrucciones scoped, contratos visuales y técnicos, y pruebas del área. Verificar el estado actual de los componentes y sus siblings antes de crear otra vía de estado o navegación.

El proyecto aporta rutas, stack, convenciones, IDs semánticos, diseño, documentos del editor y fuentes de verdad. Seguir su precedencia cuando código y contrato difieren.

## 4. Método y criterios

1. Formular la responsabilidad de la vista y separar presentación, coordinación de interacción y reglas de dominio.
2. Identificar el owner de cada dimensión de estado y el evento que confirma su transición. Declarar estados intermedios y salidas para éxito, error, cancelación y recarga cuando apliquen.
3. Elegir la frontera de datos de cada superficie. Una lista consume la forma mínima necesaria; el detalle obtiene contenido cuando se solicita. Considerar hydration, listeners y trabajo derivado en el camino crítico.
4. Comprobar que la navegación y las operaciones locales mantienen una experiencia coherente en los runtimes que el producto soporta.
5. Construir componentes semánticos, accesibles y adaptables al tamaño de pantalla. Seguir los tokens y contratos visuales del proyecto.
6. Para editores o frameworks especializados, consultar la guía técnica condicionada y comprobar que sus extensiones no adquieren ownership de persistencia o identidad.
7. Seguir los consumidores y pruebas de las APIs modificadas; validar el flujo completo y sus estados observables.

## 5. Resultado y evidencia

Entregar el cambio con owner de estado y boundary identificados, componentes y rutas afectados, contrato visual aplicado y validación del comportamiento. La evidencia debe cubrir las transiciones materiales, el flujo de usuario y la carga crítica que el cambio altera.

Cuando el proyecto define un checklist o formatos de salida más precisos, aplicarlos desde su especialidad local.

## 6. Manejo de fallos e incertidumbre

Si dos mecanismos pueden decidir la misma transición, aclarar la autoridad y el orden antes de agregar otro guard o efecto. Si falta el contrato de contenido, identidad o navegación, registrar la brecha con el consumer afectado. Un estado transitorio necesita una salida visible o recuperable cuando la operación falla.

Comprobar el comportamiento en el runtime y modo de distribución relevantes para el cambio; las diferencias entre desarrollo y producción se verifican con la guía técnica aplicable.

## 7. Relaciones y ownership

Architecture clasifica responsabilidad y runtime. Recon encuentra owners y consumidores existentes. Design fija el sistema visual; Performance analiza forma de carga y costo al crecer; UX Testing valida el recorrido observable. Frontend implementa la interacción conforme a esos contratos.

## 8. Recursos asociados

- **Runtime y editor:** en Odessay, [runtime-and-editor.md](specialties/runtime-and-editor.md) reúne stack, contratos documentales, carga, transiciones y TipTap. Cargarlo cuando el cambio toque esas decisiones y leer las secciones correspondientes al scope: documentos/runtime, velocidad e hidratación, estado transicional o editor.
- **Componentes e interacción:** [components-and-interaction.md](specialties/components-and-interaction.md) reúne CSS, estructura, IDs, estados de UI, responsive y accesibilidad. Cargarlo para cambios de interfaz y consultar la sección del componente o interacción afectada más el checklist de entrega.
- **Instrucciones scoped:** cargar el AGENTS.md del subtree afectado y los documentos que la especialidad indique.
- **Mecanismos:** usar tests de componentes, integración o recorridos existentes según el failure mode.
