# Automation & Proactive Ingestion Plan

> Plan de implementación del sistema de automatización basado en Transactional Outbox Pattern.
> Cubre: procesamiento proactivo de emails, scraping de páginas, reminders automáticos y webhooks externos (n8n).

---

## Problema a resolver

El sistema actual es **100% reactivo**: solo hace algo cuando el usuario lo pide por chat.
Los flujos que queremos son proactivos:

- El sistema lee correos del colegio y genera propuestas sin que nadie lo pida
- Un evento que se crea genera su reminder automáticamente
- Una página web se revisa diariamente y genera propuestas si hay fechas nuevas
- n8n puede disparar acciones desde cualquier trigger externo

---

## Patrón elegido: Transactional Outbox

### Por qué este patrón

| Alternativa                   | Por qué no                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Cron que ejecuta directamente | No garantiza atomicidad — si falla a mitad, el estado queda inconsistente        |
| Redis / BullMQ                | Requiere infraestructura adicional — overkill para el MVP                        |
| EventEmitter de Node          | Serverless: los procesos no persisten, el emitter se pierde en cualquier restart |
| Event Sourcing                | Sobreingeniería para este dominio                                                |

**Transactional Outbox con Postgres** es el estándar industria para apps con Postgres que no quieren añadir infraestructura de colas todavía. Usa `SELECT ... FOR UPDATE SKIP LOCKED` para garantizar que múltiples instancias de Vercel no procesen el mismo evento dos veces.

**Migración futura**: cuando se llegue a >500 hogares activos, el único cambio es reemplazar el cron-pump por un worker de BullMQ/SQS que lea la misma tabla de outbox. Los handlers no cambian.

---

## Arquitectura del sistema

```
FUENTES EXTERNAS (pollers — Vercel Cron diario/cada N min)
┌────────────────────────┐   ┌────────────────────────────┐
│  GmailPoller           │   │  WebScraperPoller          │
│  - Gmail API           │   │  - fetch(url)              │
│  - label:family-copilot│   │  - LLM extract events      │
│  - emails nuevos only  │   │  - diff vs ya procesados   │
└──────────┬─────────────┘   └─────────────┬──────────────┘
           │                               │
           ▼                               ▼
┌──────────────────────────────────────────────────────────┐
│  automation_outbox (Postgres)                            │
│  status: PENDING → PROCESSING → DONE / FAILED           │
│  processAt: permite delay y retry con backoff exponencial│
└───────────────────────────┬──────────────────────────────┘
                            │
                  Vercel Cron /api/cron/pump (c/1 min)
                  SELECT FOR UPDATE SKIP LOCKED
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│  dispatcher.ts                                           │
│  → evalúa tipo de evento                                 │
│  → aplica reglas (rules.ts)                              │
│  → llama al handler correspondiente                      │
└──────────────────────────────────────────────────────────┘
           │                               │
           ▼                               ▼
┌──────────────────┐             ┌──────────────────────────┐
│  Domain Actions  │             │  Inbox Agent (LLM)       │
│  createReminder  │             │  - analiza email/HTML    │
│  sendWhatsApp    │             │  - decide: evento directo│
│  createEvent     │             │    vs propuesta pendiente│
└──────────────────┘             └──────────────────────────┘
```

---

## ¿Quién decide: evento directo vs propuesta?

**El inbox agent (LLM)** — la misma lógica que ya existe en el prompt.

Los handlers del outbox llaman al inbox agent programáticamente con el contenido del email/página como input, exactamente igual que si el usuario lo hubiera pegado en el chat. El inbox agent aplica la regla de confianza:

```
confidence >= 0.9  →  datos claros (título + fecha + hora explícitos)
                   →  create_proposal → approve_proposal inmediatamente
                   →  resultado: CalendarEvent creado

confidence < 0.9   →  datos parciales o ambiguos (falta hora, lugar incierto, etc.)
                   →  create_proposal (queda en status: PENDING)
                   →  usuario recibe notificación: "📬 Nuevo aviso del colegio — revisalo"
                   →  usuario aprueba/edita/rechaza desde la UI
```

El LLM **nunca crea eventos directamente** — siempre pasa por ActionProposal. Lo que cambia es solo si la propuesta se auto-aprueba o espera al humano. El humano sigue siendo el gatekeeper de lo ambiguo.

---

## Schema nuevo: 2 tablas

### AutomationOutbox

```prisma
model AutomationOutbox {
  id          String    @id @default(cuid())
  householdId String
  type        String    // ver tipos de eventos abajo
  payload     Json      @db.JsonB
  source      String    // "agent" | "cron" | "webhook" | "poller"
  status      String    @default("PENDING")  // PENDING | PROCESSING | DONE | FAILED
  attempts    Int       @default(0)
  lastError   String?
  processAt   DateTime  @default(now())  // permite scheduling y retry con backoff
  createdAt   DateTime  @default(now())
  processedAt DateTime?

  @@index([status, processAt])
  @@map("automation_outbox")
}
```

### WatchedSource

```prisma
model WatchedSource {
  id            String    @id @default(cuid())
  householdId   String
  type          String    // "gmail_label" | "webpage" | "rss"
  name          String    // "Colegio San Martín — web"
  config        Json      // { label: "family-copilot" } o { url: "...", cssSelector: "..." }
  memberId      String?   // para quién es (Violeta, Pauli, etc.)
  enabled       Boolean   @default(true)
  lastCheckedAt DateTime?
  lastItemId    String?   // último emailId o URL hash procesado (evita reprocesar)
  createdAt     DateTime  @default(now())

  @@index([householdId, type])
  @@map("watched_sources")
}
```

---

## Tipos de eventos del outbox

### Eventos externos (generados por pollers)

| Tipo                   | Origen                        | Handler                              |
| ---------------------- | ----------------------------- | ------------------------------------ |
| `inbox.email_received` | GmailPoller                   | Llama inbox agent con body del email |
| `inbox.page_scraped`   | WebScraperPoller              | Llama inbox agent con texto extraído |
| `webhook.n8n_trigger`  | POST /api/webhooks/automation | Despacha según `payload.action`      |

### Eventos internos (generados por domain actions, en la misma transacción)

| Tipo                  | Disparado por                        | Handler                                      |
| --------------------- | ------------------------------------ | -------------------------------------------- |
| `proposal.approved`   | approveProposalTool                  | Mover lógica de dispatchEntityCreation       |
| `event.created`       | createCalendarEventTool              | Auto-crear reminder 30min (y 24h si MEDICAL) |
| `event.starting_soon` | Cron                                 | Enviar alerta por canal configurado          |
| `reminder.due`        | Cron                                 | Enviar notificación (WhatsApp / in-app)      |
| `proposal.expired`    | Cron (proposals viejas sin resolver) | Notificar al usuario                         |

---

## Reglas (rules engine)

Para el MVP, las reglas viven en código. Cuando se necesite configuración por hogar, se leen de `HouseholdPreferences.automationRules: Json` sin cambiar el dispatcher.

```typescript
// src/lib/automation/rules.ts

export const RULES: Record<string, Rule[]> = {
  "event.created": [
    {
      condition: (p) => !!p.startsAt,
      action: "create_reminder",
      params: (p) => ({ minutesBefore: 30, eventId: p.eventId }),
    },
    {
      condition: (p) => p.eventType === "MEDICAL",
      action: "create_reminder",
      params: (p) => ({ minutesBefore: 1440, eventId: p.eventId }), // 24h antes
    },
  ],
  "reminder.due": [
    {
      condition: (p) => p.channel === "WHATSAPP" && !!p.memberPhone,
      action: "send_whatsapp",
    },
    {
      condition: (p) => p.channel === "IN_APP",
      action: "create_in_app_notification",
    },
  ],
};
```

---

## Estructura de archivos nueva

```
src/lib/automation/
  dispatcher.ts                  ← tipo AutomationEvent, función dispatch()
  rules.ts                       ← reglas por tipo de evento
  pollers/
    gmail-poller.ts              ← lee Gmail API filtrado por label/carpeta
    web-scraper.ts               ← fetch + LLM extract events
  handlers/
    proposal-approved.handler.ts ← mueve lógica de dispatchEntityCreation
    event-created.handler.ts     ← auto-crea reminders
    reminder-due.handler.ts      ← envía notificación
    inbox-email.handler.ts       ← llama inbox agent con email body
    inbox-page.handler.ts        ← llama inbox agent con HTML procesado

src/app/api/
  cron/
    pump/route.ts                ← procesa outbox (SKIP LOCKED, retry+backoff)
    pollers/route.ts             ← ejecuta GmailPoller + WebScraperPoller
  webhooks/
    automation/route.ts          ← endpoint para n8n (HMAC auth)
```

---

## Gmail Poller — detalle de implementación

### Configuración mínima para el usuario

El usuario crea un label en Gmail: `family-copilot` (o varios: `colegio`, `familia`).
Gmail permite configurar filtros automáticos: `from: @colegio.edu.uy → aplicar label: family-copilot`.

El poller lee solo esos emails. El usuario controla qué entra — sin falsos positivos.

### Lógica del poller

```typescript
// GmailPoller.run(householdId)
// 1. Leer WatchedSource WHERE type='gmail_label' AND householdId
// 2. Para cada fuente:
//    - Gmail API: messages.list(q: `label:${config.label} is:unread after:${lastCheckedAt}`)
//    - Para cada email nuevo (id != lastItemId):
//        INSERT automation_outbox { type: "inbox.email_received", payload: { emailId, memberId, sourceId } }
//    - UPDATE WatchedSource SET lastItemId=lastEmailId, lastCheckedAt=now()
// 3. Marcar emails como leídos o agregar label "copilot-procesado"
```

La Gmail API ya está implementada en `src/lib/tools/inbox/gmail.ts` — el poller la reutiliza directamente.

---

## Web Scraper — detalle de implementación

### El problema: cada sitio tiene estructura distinta

**Solución**: LLM como parser universal. El HTML se sanitiza, se trunca a ~8000 tokens, y gpt-4o-mini extrae los eventos.

```typescript
// WebScraperPoller.run(householdId)
// 1. Leer WatchedSource WHERE type='webpage'
// 2. Para cada fuente:
//    - fetch(config.url) → HTML
//    - strip tags, truncar a 8000 chars
//    - gpt-4o-mini: "Extraé todos los eventos con fecha de este texto"
//    - Para cada evento nuevo (diff vs hash de última corrida):
//        INSERT automation_outbox { type: "inbox.page_scraped", payload: { events, sourceId, url } }
//    - UPDATE WatchedSource SET lastCheckedAt=now()
```

**Casos de uso probados**:

- Páginas de colegios con calendario de actividades
- Sites de clubes deportivos con fixture
- Páginas de actividades extracurriculares

**Nota**: PDFs del colegio que llegan por email → ya cubiertos por GmailPoller (el inbox agent ya procesa PDFs adjuntos).

---

## Webhook endpoint para n8n

```
POST /api/webhooks/automation
Authorization: Bearer AUTOMATION_WEBHOOK_SECRET
Content-Type: application/json

{
  "type": "inbox.email_received",
  "payload": { ... },
  "source": "n8n",
  "householdId": "..."
}

→ valida HMAC signature
→ INSERT automation_outbox { status: PENDING }
→ return 200 inmediatamente (el webhook no espera procesamiento)
```

n8n se conecta a esta URL con sus triggers: nuevo email en Gmail, nuevo evento en Google Calendar externo, webhook de VTEX, etc.

---

## Cron pump — garantía de at-least-once delivery

```sql
-- Cada 1 minuto, Vercel Cron llama /api/cron/pump
-- El pump usa SKIP LOCKED para evitar procesamiento doble:

BEGIN;
  SELECT * FROM automation_outbox
  WHERE status = 'PENDING' AND "processAt" <= NOW()
  ORDER BY "processAt" ASC
  LIMIT 10
  FOR UPDATE SKIP LOCKED;  -- ← garantiza que dos instancias no toman la misma fila

  UPDATE automation_outbox SET status = 'PROCESSING' WHERE id IN (...);
COMMIT;

-- Para cada evento:
try {
  await dispatch(event)
  UPDATE SET status='DONE', processedAt=now()
} catch (e) {
  attempts++
  // Backoff exponencial: 1min, 5min, 30min
  processAt = now() + exponentialBackoff(attempts)
  status = attempts >= 3 ? 'FAILED' : 'PENDING'
  lastError = e.message
}
```

Los eventos `FAILED` son visibles en Prisma Studio para debugging. No hay nada que se pierda silenciosamente.

---

## Plan de implementación paso a paso

### Paso 1 — Schema (30 min)

- Agregar `AutomationOutbox` a `schema.prisma`
- Agregar `WatchedSource` a `schema.prisma`
- `pnpm prisma:migrate`

### Paso 2 — Dispatcher + handlers base (1.5 h)

- `src/lib/automation/dispatcher.ts`
- `src/lib/automation/rules.ts`
- `src/lib/automation/handlers/proposal-approved.handler.ts` (mover desde proposals/index.ts)
- `src/lib/automation/handlers/event-created.handler.ts`
- `src/lib/automation/handlers/reminder-due.handler.ts`
- Modificar `proposals/index.ts` para llamar `dispatch()` en lugar de inline

### Paso 3 — Cron pump (1 h)

- `src/app/api/cron/pump/route.ts` con `SELECT FOR UPDATE SKIP LOCKED`
- `vercel.json` con cron schedule
- Modificar `createCalendarEventTool` para insertar en outbox (misma transacción)

### Paso 4 — Gmail Poller (1.5 h)

- `src/lib/automation/pollers/gmail-poller.ts`
- `src/lib/automation/handlers/inbox-email.handler.ts`
- `src/app/api/cron/pollers/route.ts`
- UI básica en Settings para configurar labels de Gmail

### Paso 5 — Webhook para n8n (30 min)

- `src/app/api/webhooks/automation/route.ts`
- Variable de entorno `AUTOMATION_WEBHOOK_SECRET`
- Documentación de payload formato

### Paso 6 — Web Scraper (2 h)

- `src/lib/automation/pollers/web-scraper.ts`
- `src/lib/automation/handlers/inbox-page.handler.ts`
- UI en Settings para agregar URLs a vigilar

**Total estimado: ~7 horas** (pasos 1-5 dan el sistema funcional; paso 6 es incremental)

---

## Lo que NO se implementa en MVP (deliberadamente)

| Cosa descartada                        | Razón                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------- |
| Redis / BullMQ                         | Postgres con SKIP LOCKED es suficiente hasta >500 hogares activos           |
| Dead Letter Queue separada             | `status=FAILED` en Postgres tiene el mismo efecto, visible en Prisma Studio |
| Event Sourcing                         | Sobreingeniería — el estado actual en las tablas existentes es suficiente   |
| Múltiples workers                      | Vercel Cron con SKIP LOCKED ya maneja concurrencia correctamente            |
| Un agente LLM por fuente               | El dispatcher con WatchedSource configurable es más mantenible              |
| Clasificación por LLM antes del poller | Aumenta costo y latencia — los labels de Gmail son suficientes para filtrar |

---

## Migración a colas reales (cuando sea necesario)

El único cambio cuando se llegue a escala es **reemplazar el cron-pump** por un worker de BullMQ/SQS que lea la misma tabla `automation_outbox`. Los handlers, el dispatcher, las reglas y el schema no cambian. La migración es un cambio de consumidor, no de arquitectura.
