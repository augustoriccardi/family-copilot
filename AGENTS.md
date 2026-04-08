# Family Copilot — Reglas de Negocio para Agentes

> Este archivo define el norte del producto, las reglas de negocio invariables, y los principios que deben guiar cada decisión técnica.
> Para convenciones técnicas y comandos de desarrollo, ver `.github/copilot-instructions.md` y `CLAUDE.md`.

---

## El corazón del producto

> **Tu valor no es automatizar todo; tu valor es ayudar a decidir bien y actuar a tiempo.**

El loop de valor es:

```
Capturar información → convertirla en sugerencias confiables → confirmar lo importante → ejecutar recordatorios y preparación
```

Cada feature debe poder responder: **¿en cuál de estos cuatro pasos encaja?** Si no encaja en ninguno, probablemente está fuera de scope.

---

## Reglas de negocio invariables

### 1. El humano siempre confirma lo importante

- El agente **nunca** crea CalendarEvents, Reminders ni ShoppingItems directamente al primer intento. Siempre pasa por `ActionProposal` con `status: PENDING`.
- Solo se auto-aprueba una propuesta cuando `confidence >= 0.9` Y el título, fecha y hora son explícitos en los datos de entrada.
- Si hay ambigüedad (hora faltante, participante incierto, interpretación necesaria), la propuesta queda `PENDING` y el usuario decide.
- El usuario puede siempre editar antes de aprobar. La aprobación directa es el camino feliz, no el único.

### 2. El agente es un colaborador, no un ejecutor ciego

- El agente sugiere, propone, y pregunta cuando no está seguro. No asume.
- Cuando un usuario dice "agenda esto" con datos suficientes, el flujo es: `analyze → create_proposal → approve` (en una sola conversación).
- Cuando los datos son incompletos, el agente crea la propuesta y **notifica** al usuario para que complete.

### 3. La fuente de verdad es la base de datos

- El agente solo confirma lo que una tool devuelve, nunca datos que solo existen en el contexto de la conversación.
- Después de crear o modificar cualquier entidad, el agente cita los IDs y datos devueltos por la tool, no los datos del mensaje original del usuario.

### 4. Un miembro identificado por conversación

- Cada conversación puede tener un `memberId` activo (quien va a usar el sistema en ese momento).
- El agente resuelve ambigüedades de identidad preguntando al usuario, no asumiendo el primer miembro de la lista.
- Las herramientas de Gmail y Calendar leen los datos del miembro identificado, nunca de otro miembro sin confirmación explícita.

### 5. La automatización proactiva respeta el mismo patrón

- El Automation Dispatcher (ver `docs/AUTOMATION_PLAN.md`) sigue las mismas reglas: todo pasa por `ActionProposal`.
- Los pollers (Gmail, web scraping) insertan en `automation_outbox`; el inbox agent LLM decide confidence; el humano es el gatekeeper final.
- Nunca crear eventos directamente desde un cron o webhook sin pasar por el flujo de propuesta.

---

## Scope del producto

### Dentro del scope

- **Familia como unidad**: hogar, miembros, y relaciones entre ellos (quién va a qué, quién necesita qué).
- **Eventos y compromisos**: todo lo que ocupa tiempo en el calendario familiar.
- **Recordatorios de preparación**: no solo "tenés evento", sino "necesitás preparar X antes del evento Y".
- **Ingesta proactiva**: emails del colegio, páginas de actividades, fotos de avisos.
- **Compras y organización doméstica**: lista de compras, gestión de despensa.
- **Recetas y planificación de comidas**: qué cocinar, qué falta comprar.
- **Notificaciones oportunas**: WhatsApp, in-app — en el momento correcto, no en cualquier momento.

### Fuera del scope (por ahora o siempre)

- **Finanzas familiares**: presupuestos, gastos, inversiones — es otro dominio con otra complejidad.
- **Gestión escolar completa**: notas, comunicados, portal del colegio — se captura vía email/imagen, no se integra directamente.
- **CRM familiar**: tracking de relaciones sociales, cumpleaños de terceros — demasiado amplio.
- **Automatización sin supervisión**: el agente no toma decisiones irreversibles sin confirmación humana.
- **Multi-household**: en MVP, un hogar por instancia. Multi-tenant es una decisión de producto futura.

---

## Reglas de ingeniería derivadas del negocio

### Modificaciones a AGENTS.md

**Regla obligatoria**: Antes de modificar `AGENTS.md`, el agente debe presentar la mejora propuesta al usuario y esperar aprobación explícita. Nunca editar este archivo directamente sin confirmación.

### Prisma schema → README

**Regla obligatoria**: Cada vez que se modifica `prisma/schema.prisma` (agregar, eliminar o renombrar modelos o campos relevantes), se debe actualizar el diagrama Mermaid en `README.md` en la sección correspondiente. Esta regla no es opcional — el diagrama es la documentación viva del dominio.

### Decisión LLM en automatización

La decisión "evento directo vs propuesta pendiente" siempre la toma el **inbox agent**, no el handler. Los handlers llaman al inbox agent con el contenido a procesar y dejan que el LLM aplique la regla de confianza del prompt. Esto evita duplicar lógica fuera del prompt.

### Proposals como gateway

`ActionProposal` es el contrato central del dominio. Cualquier nueva entidad que el agente pueda crear (CalendarEvent, Reminder, ShoppingItem, Recipe, etc.) debe poder originarse desde una propuesta. Si una tool crea una entidad sin pasar por el gateway de propuesta, hay que evaluar si rompe la regla de "humano confirma".

### Outbox transaccional

Los eventos de dominio (evento creado, propuesta aprobada, reminder vencido) se escriben en `automation_outbox` **en la misma transacción** que la acción principal. Nunca disparar side effects fuera de transacción — si la transacción falla, los side effects no deben ejecutarse.

### Confianza sobre eficiencia

Siempre que haya un tradeoff entre **velocidad de ejecución** (hacer la acción automáticamente) y **confianza del usuario** (mostrar qué se va a hacer), se prefiere la confianza. El usuario prefiere aprobar algo correcto que descubrir que algo incorrecto fue hecho sin su conocimiento.

---

## Anti-patterns a evitar

| Anti-pattern                                         | Regla correcta                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| Crear entidades directamente desde un cron           | Siempre pasar por `ActionProposal` + outbox                          |
| Confirmar datos al usuario que no vienen de una tool | Solo confirmar lo que devuelve la tool (ID, campos guardados)        |
| Asumir el miembro activo sin verificar               | Preguntar o usar el `memberId` del contexto de sesión                |
| Auto-aprobar propuestas con datos incompletos        | `confidence < 0.9` → queda `PENDING`                                 |
| Agregar features "porque sería útil"                 | Preguntar: ¿en cuál de los 4 pasos del loop encaja?                  |
| Duplicar lógica de decisión fuera del prompt         | El inbox agent es el lugar central de la lógica event-vs-proposal    |
| Side effects fuera de transacción DB                 | Outbox dentro de la misma transacción que la acción principal        |
| Over-engineering para casos hipotéticos              | Resolvé el caso concreto primero; abstraé cuando hay 3+ casos reales |

---

## Documentación de referencia

| Doc                               | Cubre                                             |
| --------------------------------- | ------------------------------------------------- |
| `docs/ARCHITECTURE.md`            | Diseño de sistema y decisiones técnicas           |
| `docs/AUTOMATION_PLAN.md`         | Plan completo del Automation Dispatcher y pollers |
| `docs/AGENT_ROADMAP.md`           | Roadmap de features del agente                    |
| `docs/THREAD_FLOW.md`             | Flujo de conversación y threading                 |
| `docs/OAUTH.md`                   | Autenticación OAuth con Google                    |
| `.github/copilot-instructions.md` | Comandos de desarrollo y patrones técnicos        |
