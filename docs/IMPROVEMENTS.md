# Plan de Mejoras — Family Copilot

> **Fecha:** Abril 2026  
> **Base:** Estado actual del código + análisis de gaps contra el modelo de Eventos → Reglas → Acciones

---

## Canales de ingesta de eventos externos

Esta es la pregunta clave antes de implementar cualquier otra cosa: **¿cómo entran los eventos externos al sistema?**

### Canales disponibles hoy

| Canal | Tipo | Estado |
|---|---|---|
| WhatsApp webhook | **Push** — Meta nos llama cuando llega un mensaje | ✅ Implementado |
| Upload de archivo en el chat | **Manual** — el usuario sube PDF/imagen | ✅ Implementado |
| Gmail (`read_gmail_inbox`) | **Pull** — el usuario pide "revisá mi correo" | ✅ Implementado |

El problema: Gmail y archivos son **reactivos**. El usuario tiene que acordarse de pedirlo. No hay ingesta automática.

### Opciones para ingesta proactiva

#### Opción A — WhatsApp como canal principal de ingesta (recomendada para V1)

La familia ya usa WhatsApp. El flujo natural es:

1. La dirección del colegio manda un PDF por WhatsApp al grupo familiar
2. Uno de los adultos lo **reenvía al número del bot** (o al grupo donde está el bot)
3. El webhook recibe el mensaje con adjunto → inbox agent extrae → crea propuesta

**Por qué es la mejor opción para V1:**
- No requiere nada nuevo de infraestructura (el webhook ya existe)
- Cambio de comportamiento mínimo para la familia (forward en WhatsApp es natural)
- Funciona para imágenes, PDFs y texto

**Lo que falta implementar:** el webhook de WhatsApp hoy solo procesa texto. Hay que agregar soporte para mensajes con media (imágenes/documentos). Meta envía un `mediaId` que se descarga vía API.

#### Opción B — Gmail Push Notifications (V2)

Google ofrece la API `gmail.users.watch` que manda una notificación a un endpoint nuestro cada vez que llega un email nuevo.

Flujo:
1. Al conectar Google en Settings → llamar a `gmail.users.watch` con un Cloud Pub/Sub topic
2. Google Pub/Sub → `POST /api/google/gmail-push` con el `historyId` del email nuevo
3. El endpoint descarga el email y dispara el inbox agent automáticamente

**Problema:** requiere Google Cloud Pub/Sub. Añade complejidad operativa que no tiene sentido en V1.

#### Opción C — Cron job de polling (alternativa simple a B)

Un cron job (ej: Vercel Cron) que cada hora llama a Gmail para los adultos con Google conectado.

```
POST /api/cron/check-gmail   (protegido con CRON_SECRET)
→ Para cada miembro con CalendarConnection activa
→ Llama readGmailInbox con query "is:unread newer_than:2h"
→ Por cada email relevante → inbox agent → create_proposal
```

**Ventaja sobre Pub/Sub:** no requiere Google Cloud.  
**Desventaja:** latencia de hasta 1 hora. No es "real-time" pero para circulares escolares es suficiente.

#### Opción D — Email forwarding a dirección propia

La familia reenvía emails manualmente a `copilot@familycopilot.com`. Hay servicios como Postmark, Resend o Sendgrid Inbound que hacen un `POST` a nuestro webhook cuando llega un email a esa dirección.

**Útil para:** familias que prefieren email a WhatsApp. Más parecido a Como Trello/Jira reciben emails.

---

### Decisión para V1

**Canal principal:** WhatsApp + upload manual en chat  
**Canal secundario:** Gmail pull a pedido del usuario  
**Backlog V2:** cron de polling Gmail, Gmail Push Notifications

El 80% de los eventos externos que le importan a una familia argentina llegan por WhatsApp (grupos del colegio, grupos de padres). El bot ya tiene el webhook. Solo falta procesar mensajes con media.

---

## Contexto: el modelo correcto del producto

El valor central de la app NO es tener muchos agentes. Es este flujo:

```
Evento → Reglas → Acción
```

- **Evento**: cualquier cosa que entra al sistema (interno o externo)
- **Reglas**: el sistema decide si actúa solo, propone, pide aprobación o ignora
- **Acción**: crea propuesta, crea evento confirmado, crea recordatorio, sugiere compra, notifica

**La regla de oro**: todo lo externo o ambiguo entra como **propuesta**, nunca como verdad directa.

---

## Estado actual vs. lo que debe ser

| Área | Estado hoy | Estado objetivo |
|---|---|---|
| Eventos externos (email, PDF) | inbox extrae → calendar crea directamente | inbox extrae → crea `ActionProposal` → usuario aprueba → calendar crea |
| Supervisor | solo rutea al agente correcto | aplica reglas antes de rutear (¿es externo? ¿duplicado? ¿sensible?) |
| Recordatorios derivados | solo se crean si el usuario los pide | se crean automáticamente al confirmar un evento |
| Notification agent | subagente separado en el grafo | servicio interno, no agente |
| Duplicados | no se detectan | verificación antes de crear cualquier entidad |
| Preferencias alimentarias | `FamilyConstraint` existe pero no se expone bien | tools explícitas en family agent |

---

## Mejora 1 — `ActionProposal` (la más importante)

### Problema
Hoy no existe la entidad "propuesta". Cuando inbox detecta un evento en un correo o imagen, el flujo pasa directamente a crear un `CalendarEvent` con `status: CONFIRMED`. Esto viola la regla de oro del producto.

### Lo que falta

**Prisma schema** — agregar modelo:
```prisma
enum ProposalStatus {
  PENDING
  APPROVED
  REJECTED
  EDITED
}

enum ProposalType {
  EVENT
  REMINDER
  SHOPPING_ITEM
  DOCUMENT
  OTHER
}

model ActionProposal {
  id          String         @id @default(cuid())
  householdId String         @map("household_id")
  memberId    String?        @map("member_id")       // para quién es la propuesta
  type        ProposalType
  status      ProposalStatus @default(PENDING)
  title       String
  description String?
  payload     Json           @db.JsonB               // EventCandidate | ProductIntentItem | etc.
  source      String                                 // "email" | "pdf" | "image" | "web" | "manual"
  confidence  Float          @default(0.0)           // 0–1, qué tan seguro está el agente
  notes       String?                                // por qué lo propone
  resolvedAt  DateTime?      @map("resolved_at")
  createdAt   DateTime       @default(now()) @map("created_at")
  updatedAt   DateTime       @updatedAt @map("updated_at")

  household Household     @relation(fields: [householdId], references: [id], onDelete: Cascade)
  member    FamilyMember? @relation(fields: [memberId], references: [id], onDelete: SetNull)

  @@index([householdId, status])
  @@map("action_proposals")
}
```

**Tools nuevas en inbox agent:**
- `create_proposal(type, title, payload, source, confidence)` — crea propuesta en lugar de crear directamente
- `list_pending_proposals()` — lista propuestas pendientes del hogar
- `get_proposal(proposalId)` — detalle de una propuesta

**Tools nuevas en calendar/shopping agent:**
- `approve_proposal(proposalId)` — convierte propuesta en entidad real
- `reject_proposal(proposalId, reason?)` — descarta la propuesta
- `edit_and_approve_proposal(proposalId, changes)` — modifica y aprueba

**Regla en el supervisor:**
- Si la fuente del request es externa (inbox procesó algo) → el subagente DEBE usar `create_proposal`, no `create_calendar_event` ni `add_to_shopping_list` directamente

**UI:**
- Panel "Propuestas pendientes" en el sidebar o thread
- Cards con Aprobar / Editar / Ignorar por propuesta
- Badge con contador de pendientes

---

## Mejora 2 — Supervisor aplica reglas de negocio

### Problema
El supervisor actual solo hace routing lingüístico: "¿de qué habla esto?" → rutea. No aplica las reglas de negocio definidas en el modelo.

### Reglas que el supervisor debe aplicar antes de rutear

```
1. FUENTE EXTERNA → siempre propuesta primero
   Si el input viene de inbox (imagen, PDF, email), el resultado debe ser ActionProposal.

2. AFECTA AGENDA OFICIAL → requiere aprobación
   Crear/modificar evento en calendario de otro miembro, mover fechas confirmadas.

3. IMPLICA GASTO → requiere aprobación
   Agregar items a lista activa de compras, sugerir carrito.

4. BAJA CONFIANZA (confidence < 0.7) → siempre propuesta
   Si inbox extrae algo con baja certeza, no puede crear entidades reales.

5. DUPLICADO POTENCIAL → no crear, marcar como posible duplicado
   Antes de crear evento o recordatorio, verificar si ya existe uno similar
   (mismo título aproximado + misma fecha/hora + mismo miembro).
```

### Cambios concretos

- Agregar tool `check_duplicate(type, title, date?, memberId?)` en calendar y reminder
- Actualizar `SUPERVISOR_PROMPT` con sección "Reglas de negocio antes de ejecutar"
- Subagentes deben recibir el flag `sourceIsExternal: boolean` en el contexto para saber si deben crear propuesta o entidad directa

---

## Mejora 3 — Recordatorios derivados automáticos

### Problema
Hoy un recordatorio solo se crea cuando el usuario lo pide explícitamente. El sistema no genera recordatorios automáticos cuando se confirma un evento importante.

### Comportamiento esperado

Cuando se confirma un `CalendarEvent`:
- Si `minutesBefore` no está definido → calcular automáticamente según tipo de evento
- Si el evento requiere preparación (paseo, actividad escolar, médico) → sugerir recordatorio previo
- Si el evento tiene `responsibleMemberId` → crear recordatorio para esa persona

### Cambios concretos

**Tool nueva en reminder agent:**
```typescript
create_reminders_for_event(eventId: string, strategy?: "conservative" | "full")
```
- `conservative`: 1 recordatorio 30 minutos antes
- `full`: recordatorio el día anterior + 30 minutos antes + preparación si aplica

**Lógica de inferencia por tipo de evento:**

| EventType | Recordatorio sugerido |
|---|---|
| SCHOOL | Día anterior 20:00 + 30 min antes |
| MEDICAL | Día anterior 10:00 + 2h antes |
| ACTIVITY | 1h antes |
| BIRTHDAY | 1 semana antes + día del cumpleaños |
| FAMILY | 30 min antes |

**Cuándo se activa:**
- Al aprobar una `ActionProposal` de tipo `EVENT`
- Al crear manualmente un evento (opcional, con confirmación)
- El agente calendar llama `create_reminders_for_event` automáticamente post-confirmación

---

## Mejora 4 — Refactorizar notification agent como servicio

### Problema
`notification.ts` existe como subagente en el grafo LangGraph. El documento de arquitectura es claro: "Notificación es un canal/servicio, no un agente." Tener un agente separado solo para esto:
- Agrega un salto innecesario de routing en el supervisor
- El LLM puede decidir no llamarlo cuando debería
- WhatsApp y reminder ya existen como tools en otros agentes

### Cambios concretos

- Eliminar `src/lib/agent/subagents/notification.ts` del grafo del supervisor
- Eliminar `"notifications"` de `SUBAGENT_NAMES` en `supervisor.ts`
- Mantener `sendWhatsAppMessage` como función de utilidad importable
- Las tools de WhatsApp que tenía (`send_whatsapp_to_member`, etc.) se mueven a:
  - **reminder agent**: para notificaciones de recordatorios
  - **shopping agent**: para compartir lista de compras
- El `NOTIFICATIONS_AGENT_PROMPT` se elimina

---

## Mejora 5 — Family agent: exponer preferencias alimentarias

### Problema
`FamilyConstraint` tiene los tipos `DISLIKE`, `DIET`, `ALLERGY` pero el family agent no tiene tools explícitas para gestionarlos. El agente responde "no tengo información sobre preferencias alimenticias" aunque el modelo de datos sí las soporta.

### Cambios concretos

**Tools nuevas en family agent:**
- `get_food_preferences(memberId?)` — lista alergias, dislikes y dietas de uno o todos los miembros
- `set_food_preference(memberId, type: ALLERGY|DISLIKE|DIET, key, value)` — agrega o actualiza una restricción
- `remove_food_preference(constraintId)` — elimina una restricción

**Actualizar `FAMILY_AGENT_PROMPT`** para incluir sección explícita:
```
## Preferencias y restricciones alimentarias
- Usá get_food_preferences cuando te pregunten qué puede comer alguien
- Usá set_food_preference cuando alguien diga "Sofi no come mariscos" o "Juan es celíaco"
- El tipo ALLERGY es para alergias médicas, DISLIKE para preferencias, DIET para regímenes
```

---

## Mejora 6 — Detección de duplicados

### Problema
Si el usuario (o inbox) crea dos veces el mismo evento o recordatorio, el sistema los crea ambos sin advertir.

### Cambios concretos

**Tool nueva compartida (calendar + reminder):**
```typescript
check_for_duplicates(
  type: "event" | "reminder",
  title: string,
  date?: string,      // ISO date
  memberId?: string
): { isDuplicate: boolean; similarItems: { id, title, date }[] }
```

**Lógica de similaridad:**
- Mismo `memberId` + misma fecha (±1 día) + título similar (fuzzy match básico con `levenshtein` o comparación de palabras clave)
- Si `isDuplicate: true` → el agente no crea, informa y pregunta si es el mismo o uno nuevo

**En el prompt de calendar y reminder:**
- "Antes de crear cualquier evento o recordatorio, llamá siempre a `check_for_duplicates`"

---

## Mejora 7 — Separar `CalendarEvent` detectado de confirmado

### Problema
`CalendarEvent.status` tiene `CONFIRMED/TENTATIVE/CANCELLED` pero los eventos de inbox entran como `CONFIRMED` directamente. No hay distinción clara de flujo.

### Opción A (simple, preferible para V1)
Usar `ActionProposal` (Mejora 1) como la capa previa. Un evento solo llega a `CalendarEvent` cuando fue aprobado. No se necesita cambiar el status.

### Opción B (si no se implementa ActionProposal en el corto plazo)
Agregar `PROPOSED` al enum `EventStatus`:
```prisma
enum EventStatus {
  PROPOSED    // ← nuevo: viene de fuente externa, pendiente de aprobación
  CONFIRMED
  TENTATIVE
  CANCELLED
}
```
Y agregar campo `sourceProposalId` en `CalendarEvent` para trazabilidad.

**Recomendación:** implementar Opción A (ActionProposal) directamente.

---

## Mejora 8 — UI: inbox de propuestas pendientes

### Problema
Sin una UI dedicada, las `ActionProposal` pendientes no son visibles para el usuario. El flujo de aprobación no funciona si el usuario no sabe que hay algo esperando su revisión.

### Cambios en UI

**Componente `ProposalInbox`:**
- Lista de propuestas con `status: PENDING`
- Para cada propuesta: título, tipo, fuente, confidence, fecha propuesta
- Acciones: ✅ Aprobar / ✏️ Editar y aprobar / ❌ Rechazar
- Badge en sidebar con contador de pendientes

**API routes nuevas:**
- `GET /api/agent/proposals` — lista propuestas del hogar
- `POST /api/agent/proposals/[id]/approve` — aprueba y ejecuta
- `POST /api/agent/proposals/[id]/reject` — rechaza
- `PUT /api/agent/proposals/[id]` — edita payload antes de aprobar

**Dónde integrarlo:**
- Tab o sección en el sidebar junto a ThreadList
- O como componente flotante con badge cuando hay pendientes

---

## Mejora 9 — Google Calendar: per-member via CalendarConnection

### Estado actual
El MCP server de Calendar usa un único `GOOGLE_REFRESH_TOKEN` global. Los adultos pueden conectar su Google individualmente para Gmail (ya implementado), pero Calendar sigue siendo global.

### Cambio propuesto (mediano plazo)
Cuando el agente calendar crea/edita un evento para un miembro específico:
1. Buscar `CalendarConnection` del miembro
2. Si existe → usar su token personal para sincronizar en su calendario
3. Si no → usar el token global del MCP server

Esto requiere que el `calendar` agent tome el token de `CalendarConnection` y llame a Google Calendar API directamente (patrón ya implementado en Gmail).

---

## Prioridades de implementación

### 🔴 Alta — Bloquean el flujo correcto del producto

| # | Mejora | Esfuerzo estimado |
|---|---|---|
| 1 | `ActionProposal` — modelo Prisma + tools | Alto |
| 2 | UI inbox de propuestas pendientes | Alto |
| 3 | Supervisor aplica reglas (fuente externa → proposal) | Medio |

### 🟡 Media — Valor diferencial importante

| # | Mejora | Esfuerzo estimado |
|---|---|---|
| 4 | Recordatorios derivados automáticos | Medio |
| 5 | Family agent: tools de preferencias alimentarias | Bajo |
| 6 | Detección de duplicados | Medio |

### 🟢 Baja — Limpieza y calidad

| # | Mejora | Esfuerzo estimado |
|---|---|---|
| 7 | Refactorizar notification agent como servicio | Bajo |
| 8 | Separación detectado/confirmado (via ActionProposal) | Resuelto por mejora 1 |
| 9 | Calendar per-member via CalendarConnection | Alto |

---

## Qué NO hacer (para no perder foco)

- **No agregar más agentes** — school agent, approval agent, parsing agent, email agent son servicios/flujos, no agentes
- **No automatizar lo externo** — email → evento oficial sin revisión rompe la confianza del usuario
- **No scraping masivo de colegios** — retorno incierto, mantenimiento alto; mejor: email reenviado o Gmail conectado
- **No prometer compra automática en supermercados** — el mercado UY no tiene APIs estables para V1
- **No convertir la app en todo para todo** — el foco es: capturar → interpretar → proponer → confirmar → recordar → preparar

---

## Flujo objetivo completo (V1)

```
Evento externo (email, PDF, imagen)
  ↓
inbox agent: extrae y estructura
  ↓
create_proposal() → ActionProposal { status: PENDING }
  ↓
UI: notifica al usuario que hay propuestas pendientes
  ↓
Usuario: Aprobar / Editar / Rechazar
  ↓
Si aprueba:
  → calendar agent: crea CalendarEvent { status: CONFIRMED }
  → reminder agent: crea recordatorios derivados automáticos
  → shopping agent: agrega items si el evento implica preparación
  ↓
Familia organizada, sin sorpresas
```
