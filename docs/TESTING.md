# Guía de Testing — Family Copilot

Esta guía cubre **todas las funcionalidades** de la aplicación de forma ordenada. Incluye la configuración de datos de prueba, los canales externos (Gmail, web scraping, webhook), el pipeline de automatización y los canales de notificación.

---

## 0. Cómo está estructurado el sistema (leer antes de empezar)

```
Usuario/WhatsApp/cron
       │
       ▼
  Supervisor LLM ──► subagente (calendar, reminder, shopping, etc.)
       │
       ▼                       ┌─ reminder-due.handler → WhatsApp / email
  automation_outbox ──► pump ──┤
       ▲                       └─ inbox-email.handler / inbox-page.handler → inbox agent → proposal
       │
  pollers (Gmail, web scraper) + webhook n8n
```

- **`WatchedSource`**: registro en la DB que le dice al poller "vigilá este label de Gmail / esta URL web para este miembro". Sin filas en esta tabla los pollers no hacen nada.
- **Token de Google**: el mismo token OAuth que se usa para el calendario también da acceso a Gmail (el scope `gmail.readonly` ya está incluido). El token se guarda como `GOOGLE_REFRESH_TOKEN` en `.env` (global) o en la tabla `calendar_connections` (por miembro).

---

## 1. Prerrequisitos

### 1.1 Servicios locales

```bash
docker compose up -d   # Postgres en :5434 + MinIO en :9000/:9001
```

### 1.2 Variables de entorno mínimas

Copiar `.env.example` a `.env` y completar:

```env
# Obligatorias siempre
DATABASE_URL=postgresql://user:password@localhost:5434/mydb
OPENAI_API_KEY=sk-...            # o GOOGLE_API_KEY para gemini

# S3 / MinIO (ya vienen con valores de desarrollo en .env.example)
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET_NAME=uploads
S3_FORCE_PATH_STYLE=true
```

Variables opcionales (ir activando por sección):

| Variable                                             | Para qué sirve                      | Cuándo se necesita |
| ---------------------------------------------------- | ----------------------------------- | ------------------ |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`          | OAuth con Google                    | Secciones 5 y 6    |
| `GOOGLE_REFRESH_TOKEN`                               | Token global de Gmail + Calendar    | Secciones 5 y 6    |
| `GOOGLE_CALENDAR_ID`                                 | ID del calendar personal de Augusto | Sección 5          |
| `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` | Canal WhatsApp                      | Sección 7          |
| `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET`      | Webhook Meta                        | Sección 7          |
| `RESEND_API_KEY`                                     | Canal email                         | Sección 8          |
| `CRON_SECRET`                                        | Proteger endpoints cron             | Sección 9          |
| `AUTOMATION_WEBHOOK_SECRET`                          | Webhook n8n                         | Sección 10         |

### 1.3 Setup inicial

```bash
pnpm install
pnpm prisma:generate
pnpm prisma:migrate          # aplica todas las migraciones
pnpm prisma:seed             # crea Familia Test con 5 miembros
pnpm dev                     # http://localhost:3000
```

El seed imprime al final:

```
🏠 Household ID: <hh-id>
🧵 Thread ID:    <thread-uuid>
👨 Augusto ID:   <augusto-id>
👩 Pilar ID:     <pilar-id>
👧 Violeta ID:   <violeta-id>
👧 Paulina ID:   <paulina-id>
👶 Alma ID:      <alma-id>
⚡ Abrí el Thread en http://localhost:3000/thread/<thread-uuid>
```

**Guardar esos IDs** — se usan en todos los pasos siguientes.

---

## 2. Datos que el seed NO crea (configuración manual requerida)

El seed crea familia, preferencias, despensa, calendario y documento. Lo que **falta** para las funcionalidades avanzadas se configura manualmente en Prisma Studio (`pnpm prisma:studio`, [http://localhost:5555](http://localhost:5555)) o con los scripts incluidos.

### 2.1 `whatsapp_phone` en miembros adultos

Para probar notificaciones WhatsApp, los adultos necesitan teléfono:

**Prisma Studio → tabla `family_members` → editar Augusto y/o Pilar:**

| Campo            | Valor                                                    |
| ---------------- | -------------------------------------------------------- |
| `whatsapp_phone` | Tu número con código de país sin `+` (ej: `59899123456`) |
| `email`          | Tu email real (para probar canal email)                  |

### 2.2 `CalendarConnection` (token por miembro)

> Solo necesario si querés que **Pilar** pueda sincronizar su propio Google Calendar.
> Para probar el flujo básico, el token global `GOOGLE_REFRESH_TOKEN` de Augusto alcanza.

```bash
# Inicia sesión con la cuenta de Google de Pilar:
pnpm google-calendar:token
# Copia el refresh_token que imprime y agrégalo a .env:
# PILAR_GOOGLE_REFRESH_TOKEN=...
# PILAR_GOOGLE_CALENDAR_ID=primary
# Luego re-seedeá:
pnpm prisma:seed:reset && pnpm prisma:seed
```

### 2.3 `WatchedSource` para Gmail Poller

Estas filas le indican al sistema qué label de Gmail vigilar y para qué miembro.

**Opción A — Prisma Studio:**

Tabla `watched_sources` → "+ New record":

| Campo         | Valor                                            |
| ------------- | ------------------------------------------------ |
| `householdId` | `<hh-id>` del seed                               |
| `type`        | `GMAIL_LABEL`                                    |
| `name`        | `"Colegio de Violeta"` (nombre descriptivo)      |
| `config`      | `{"label": "nombre-del-label"}` ← ver nota abajo |
| `memberId`    | `<violeta-id>` (o null para el hogar en general) |
| `enabled`     | `true`                                           |

> **¿Qué poner en `label`?**
> El label de Gmail es el nombre exacto de la etiqueta en la cuenta de Google. Puede ser un label creado por vos (ej: `colegio`) o predefinido (ej: `INBOX`, `UNREAD`). Para probar sin label real podés usar `INBOX` — el poller leerá todos los mails no leídos de la bandeja.

**Opción B — SQL directo:**

```sql
INSERT INTO watched_sources (id, household_id, type, name, config, member_id, enabled, created_at)
VALUES (
  gen_random_uuid(),
  '<hh-id>',
  'GMAIL_LABEL',
  'Colegio de Violeta',
  '{"label": "colegio"}',
  '<violeta-id>',
  true,
  now()
);
```

### 2.4 `WatchedSource` para Web Scraper

| Campo      | Valor                                        |
| ---------- | -------------------------------------------- |
| `type`     | `WEBPAGE`                                    |
| `name`     | `"Web del colegio"`                          |
| `config`   | `{"url": "https://www.example.com/eventos"}` |
| `memberId` | `<violeta-id>` (opcional)                    |

> Para probar sin sitio real, podés usar cualquier página pública con fechas, por ejemplo el calendario de eventos de un club o colegio público. La URL que ponés en `url` es la que el scraper va a fetchear.

---

## 3. Flujo del token de Google — Explicación completa

El sistema tiene **dos formas** de autenticarse con Google (Gmail + Calendar):

### Forma 1: Token global (GOOGLE_REFRESH_TOKEN en .env)

```
.env → GOOGLE_REFRESH_TOKEN
      │
      ▼
resolveAccessToken(memberId = undefined)
      │
      ▼
  exchangeRefreshToken() → obtiene access_token temporal (1 hora)
      │
      ▼
  API de Gmail / Calendar con ese token
```

**Cuándo se usa**: cuando la `WatchedSource` tiene `memberId = null`, o cuando el miembro no tiene `CalendarConnection` propia en la DB.

**Cómo obtener el token:**

```bash
# 1. Primero configurar en .env:
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# 2. Ejecutar:
pnpm google-calendar:token
# → Abre el browser, pedís autorización con la cuenta de Augusto
# → Al aprobar, imprime en consola:  refresh_token: ya_29A...
# → Copiar ese valor a .env:
GOOGLE_REFRESH_TOKEN=ya_29A...
```

> ⚠️ El script ya pide los scopes `calendar` + `gmail.readonly` en un solo flujo OAuth. No necesitás hacer dos pasos separados.

### Forma 2: Token por miembro (tabla `calendar_connections`)

```
DB → calendar_connections WHERE memberId = '<pilar-id>'
      │
      ├─ accessToken vigente → lo usa directamente
      └─ accessToken expirado → llama exchangeRefreshToken(refreshToken) → actualiza en DB
```

**Cuándo se usa**: cuando una `WatchedSource` tiene `memberId = '<pilar-id>'` (o cualquier adulto con token propio). Cada adulto puede conectar su propia cuenta Google desde la UI: _Ajustes → Conectar Google_.

### Diagrama completo de resolución

```
resolveAccessToken(memberId?)
├── memberId = undefined/null
│   └── GOOGLE_REFRESH_TOKEN en .env → access_token
└── memberId = "<id>"
    └── calendar_connections WHERE memberId = "<id>"
        ├── no existe → null (Gmail poller saltea esta source)
        ├── token vigente → accessToken
        └── token expirado → refreshToken → nuevo accessToken → actualiza DB
```

---

## 4. Chat web — Subagentes conversacionales

Abrir: `http://localhost:3000/thread/<thread-uuid>`

### 4.1 Supervisor y routing

| Input                                             | Agente esperado             | Verificar en logs                |
| ------------------------------------------------- | --------------------------- | -------------------------------- |
| `hola`                                            | inbox o supervisor          | —                                |
| `¿qué podés hacer?`                               | supervisor responde directo | —                                |
| `¿quiénes somos?`                                 | `family`                    | `[supervisor] routing to family` |
| `agendá dentista para Paulina el martes a las 17` | `calendar`                  | `routing to calendar`            |
| `recordame comprar pañales el viernes a las 10`   | `reminder`                  | `routing to reminder`            |
| `mandále un mensaje a Pilar por WhatsApp`         | `notification`              | `routing to notification`        |
| `¿qué hay para cenar?`                            | `recipe`                    | `routing to recipe`              |
| `agregá leche a la lista de compras`              | `shopping`                  | `routing to shopping`            |

### 4.2 Calendar — Crear evento simple

```
Agendá dentista para Paulina el martes a las 17
```

Tool calls esperados: `find_family_member` → `check_conflicts` → `create_family_event`

**Verificar en Prisma Studio:**

- `calendar_events`: `member_id = <paulina-id>`, `event_type = MEDICAL`
- `calendar_event_participants`: fila con `role = PARTICIPANT`

### 4.3 Calendar — Evento con responsable

```
Agendá pediatra para Alma el jueves a las 16, la lleva Pilar
```

**Verificar:** `responsible_member_id = <pilar-id>`, dos filas en `calendar_event_participants`

### 4.4 Calendar — Conflicto

Crear primero el dentista del 4.2. Luego:

```
Agendá algo para Paulina el martes a las 17
```

El agente debe **no crear el evento** y reportar el conflicto.

### 4.5 Reminder — Crear recordatorio

```
Recordame comprar medicamentos el viernes a las 10
```

**Verificar en `reminders`:** `status = PENDING`, `channel = IN_APP` (default), `due_at` correcto.

### 4.6 Notification — Enviar WhatsApp

> Requiere `whatsapp_phone` cargado en el miembro y las vars de WhatsApp en `.env`.

```
Mandále un mensaje a Augusto que la cena está lista
```

Tool esperado: `send_whatsapp_to_member` con `memberId = <augusto-id>`.

### 4.7 Notification — Enviar email

> Requiere `email` cargado en el miembro y `RESEND_API_KEY` en `.env`.

```
Mandále un email a Pilar con el resumen de la semana
```

Tool esperado: `send_email_to_member`.

### 4.8 Inbox — Analizar imagen o PDF adjunto

1. Hacer click en el ícono de adjunto en el MessageInput
2. Subir una imagen de un flyer de evento escolar o un PDF de circular
3. Escribir: `Extraé los eventos de esto y agendálos`

**Flujo esperado:** supervisor → `inbox` → `create_proposal` → `approve_proposal` → evento creado.

### 4.9 Shopping

```
Creá una lista con leche, pan y frutas
```

```
Generá la lista semanal a partir de las recetas
```

### 4.10 Recipe

```
Guardá la receta de tarta de manzana: harina, azúcar, manzanas, huevos. 45 minutos.
```

```
¿Qué puedo cocinar con lo que tenemos en la despensa?
```

### 4.11 Library — Consultar documento

```
¿De qué trata el documento de la Biblia?
```

```
Generá 5 ejercicios del libro de Génesis para un chico de 10 años
```

### 4.12 Tool approval (aprobación manual)

Desactivar "Aprobar todas las herramientas" en la UI de configuración del modelo. Luego:

```
¿qué tiene Paulina esta semana?
```

Antes de ejecutar el tool debe aparecer el botón de aprobación en el chat.

---

## 5. Google Calendar — Sync con Google

> Requiere `GOOGLE_REFRESH_TOKEN` en `.env` y el seed corrido.

### 5.1 Verificar token funcionando

```bash
node scripts/get-google-token.mjs   # Si aún no tenés el token
```

Luego en el chat:

```
¿Qué eventos tengo en Google Calendar esta semana?
```

El agente llama a las tools MCP de Google Calendar (si está configurado como MCPServer) o usa la CalendarConnection del miembro.

### 5.2 Crear evento que se sincroniza a Google

```
Agendá reunión con el colegio de Violeta el próximo lunes a las 10
```

Si `MemberCalendar.googleCalendarId` está configurado para Augusto (lo hace el seed con `GOOGLE_CALENDAR_ID`), el evento debe aparecer también en Google Calendar.

---

## 6. Gmail Poller — Leer correos automáticamente

### 6.1 Prereqs

- `GOOGLE_REFRESH_TOKEN` en `.env` (token con scope `gmail.readonly`)
- Al menos una `WatchedSource` de tipo `GMAIL_LABEL` en la DB (ver sección 2.3)

### 6.2 Probar manualmente el poller

Sin esperar el cron, invocar el endpoint directamente:

```bash
curl -X GET http://localhost:3000/api/cron/pollers \
  -H "Authorization: Bearer <CRON_SECRET>"  # omitir header si CRON_SECRET no está seteado
```

**Respuesta esperada:**

```json
{
  "polled": 1,
  "results": {
    "<hh-id>": { "gmail": 1, "scraper": 0 }
  }
}
```

### 6.3 Qué pasa internamente

```
GET /api/cron/pollers
  └── runGmailPoller("<hh-id>")
        └── WatchedSource WHERE type=GMAIL_LABEL AND enabled=true
              └── resolveAccessToken(memberId?)
                    ├── memberId=null → GOOGLE_REFRESH_TOKEN de .env
                    └── memberId="<id>" → CalendarConnection en DB
              └── Gmail API: GET /messages?q=label:<label> is:unread after:<timestamp>
              └── por cada email nuevo:
                    └── dispatch({ type: "inbox.email_received", payload: { subject, from, body, ... } })
                          └── INSERT INTO automation_outbox

GET /api/cron/pump  (siguiente tick)
  └── procesa PENDING de automation_outbox
        └── handleInboxEmail(payload)
              └── buildInboxAgent() → LLM analiza el email
                    └── create_proposal (PENDING o auto-aprobado si confidence >= 0.9)
```

### 6.4 Verificar resultado

**Prisma Studio → tabla `automation_outbox`:**

- Debe aparecer una fila con `type = inbox.email_received` y `status = DONE` (tras el pump)

**Prisma Studio → tabla `action_proposals`:**

- Si el email tenía un evento con fecha bien definida: `status = APPROVED` (auto)
- Si tenía datos incompletos: `status = PENDING` (espera revisión del usuario)

### 6.5 Forzar re-proceso

Si querés que el poller vuelva a leer los mismos emails (para probar de nuevo):

```sql
-- En Prisma Studio → Raw query o terminal psql:
UPDATE watched_sources SET last_item_id = null, last_checked_at = null
WHERE type = 'GMAIL_LABEL';
```

---

## 7. WhatsApp

### 7.1 Setup ngrok

```bash
npx ngrok http 3000
# Copiá la URL pública, ej: https://abc123.ngrok.io
```

### 7.2 Variables requeridas

```env
WHATSAPP_PHONE_NUMBER_ID=<id del número en Meta Developer>
WHATSAPP_ACCESS_TOKEN=<system user token de Meta>
WHATSAPP_VERIFY_TOKEN=family-copilot-test
WHATSAPP_APP_SECRET=<app secret de la app de Meta>
```

Reiniciar `pnpm dev` después de agregar las vars.

### 7.3 Configurar webhook en Meta Developer

1. [developers.facebook.com](https://developers.facebook.com) → tu app → WhatsApp → Configuration
2. Webhook → Callback URL: `https://abc123.ngrok.io/api/whatsapp/webhook`
3. Verify Token: el mismo que `WHATSAPP_VERIFY_TOKEN`
4. Suscribir al campo `messages`

### 7.4 Vincular tu número al seed

**Prisma Studio → `family_members` → Augusto:**

- `whatsapp_phone` = tu número con código de país sin `+` (ej: `59899123456`)

### 7.5 Tests

Enviar desde el número registrado:

| Mensaje                                           | Esperado                           |
| ------------------------------------------------- | ---------------------------------- |
| `hola`                                            | Saludo del agente                  |
| `¿qué podés hacer?`                               | Lista de capacidades               |
| `agendá dentista para Paulina el martes a las 17` | Crea evento, confirma por WhatsApp |
| `¿cuándo están libres Augusto y Pilar mañana?`    | Llama `find_free_slots`            |
| `recordame comprar pañales el viernes`            | Crea reminder                      |

### 7.6 Auto-provisioning (primer contacto)

Enviar desde un número **no registrado**. Debe crearse automáticamente un `Household` nuevo y un `FamilyMember`. Verificar en Prisma Studio.

---

## 8. Canal email (Resend)

### 8.1 Setup

```env
RESEND_API_KEY=re_...         # desde resend.com → API Keys
EMAIL_FROM_ADDRESS=onboarding@resend.dev  # alias gratuito de Resend para desarrollo
```

### 8.2 Cargar email en miembro adulto

**Prisma Studio → `family_members` → Augusto:** `email = tu@email.com`

### 8.3 Probar agente notification

```
Mandále un email a Augusto con el resumen de la semana
```

Revisar la bandeja de entrada del email configurado.

### 8.4 Probar reminder con canal EMAIL

**Prisma Studio → crear Reminder:**

| Campo         | Valor                                        |
| ------------- | -------------------------------------------- |
| `householdId` | `<hh-id>`                                    |
| `memberId`    | `<augusto-id>`                               |
| `title`       | `Test email reminder`                        |
| `dueAt`       | fecha/hora en el pasado (ej: hace 5 minutos) |
| `channel`     | `EMAIL`                                      |
| `status`      | `PENDING`                                    |

Luego invocar el pump:

```bash
curl http://localhost:3000/api/cron/pump
```

El reminder debe cambiar a `status = SENT` y el email llegar.

---

## 9. Web Scraper

### 9.1 Prereqs

- Una `WatchedSource` de tipo `WEBPAGE` (ver sección 2.4)

### 9.2 Probar manualmente

```bash
curl http://localhost:3000/api/cron/pollers
```

**Respuesta esperada:**

```json
{ "results": { "<hh-id>": { "gmail": 0, "scraper": 1 } } }
```

### 9.3 Qué pasa internamente

```
runWebScraperPoller("<hh-id>")
  └── WatchedSource WHERE type=WEBPAGE
        └── solo re-chequea si lastCheckedAt < hace 24 horas (o nunca)
        └── fetch(config.url)
        └── strip HTML → truncar a 8000 chars
        └── LLM (gpt-4o-mini): extrae eventos con fecha → array JSON
        └── hash del contenido → comparar con lastItemId (evita re-procesar)
        └── si hay eventos nuevos:
              └── dispatch({ type: "inbox.page_scraped", payload: { url, events, ... } })
              └── UPDATE watched_sources SET last_item_id = hash, last_checked_at = now()
```

### 9.4 Forzar re-proceso

```sql
UPDATE watched_sources SET last_item_id = null, last_checked_at = null
WHERE type = 'WEBPAGE';
```

---

## 10. Pipeline de automatización completo

### 10.1 Cron pump

El pump procesa eventos `PENDING` de `automation_outbox` con retry y backoff:

```bash
curl http://localhost:3000/api/cron/pump
```

Respuesta:

```json
{ "processed": 3, "failed": 0, "total": 3 }
```

**Verificar en `automation_outbox`:** filas con `status = DONE` o `status = FAILED` (tras 3 intentos).

Backoff configurado: 1 min → 5 min → 30 min → `FAILED`.

### 10.2 Flujo completo evento → recordatorio automático

1. Crear evento via chat: `Agendá dentista para Paulina el martes a las 17`
2. El agente aprueba la propuesta → crea `CalendarEvent`
3. El code en `proposals/index.ts` hace `dispatch({ type: "event.created" })` (best-effort)
4. El pump procesa `event.created` → `handleEventCreated` → crea `Reminder` (30 min antes + 24h antes si es MEDICAL)
5. Cuando llega la hora del reminder → el pump procesa `reminder.due` → `handleReminderDue` → envía notificación

**Simular que vence un reminder ya:**

```sql
-- Adelantar un reminder al pasado para que el pump lo procese
UPDATE reminders SET due_at = now() - interval '1 minute', status = 'PENDING'
WHERE id = '<reminder-id>';
```

Luego:

```bash
curl http://localhost:3000/api/cron/pump
```

### 10.3 Webhook externo (n8n / Zapier)

```bash
curl -X POST http://localhost:3000/api/webhooks/automation \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <AUTOMATION_WEBHOOK_SECRET>" \
  -d '{
    "type": "inbox.email_received",
    "payload": {
      "subject": "Reunión de padres — jueves 10 de abril 18:00",
      "from": "colegio@example.com",
      "date": "Mon, 7 Apr 2026 10:00:00 -0300",
      "body": "Estimados padres, los convocamos a una reunión el jueves 10 de abril a las 18:00 en el salón principal.",
      "sourceName": "Colegio de Violeta",
      "memberId": "<violeta-id>"
    }
  }'
```

Respuesta inmediata: `{ "queued": true }`. El procesamiento ocurre en el próximo tick del pump.

> Si `AUTOMATION_WEBHOOK_SECRET` no está seteado en `.env`, el endpoint acepta cualquier request sin autenticación.

---

## 11. Verificación en base de datos

```bash
pnpm prisma:studio   # http://localhost:5555
```

| Tabla                         | Qué verificar                                                           |
| ----------------------------- | ----------------------------------------------------------------------- |
| `calendar_events`             | `member_id`, `event_type`, `responsible_member_id`, `external_event_id` |
| `calendar_event_participants` | Rol y `rsvp_status` de cada participante                                |
| `reminders`                   | `channel`, `status`, `sent`, `sent_at`                                  |
| `action_proposals`            | `status` (PENDING / APPROVED / REJECTED), `confidence`                  |
| `automation_outbox`           | `type`, `status`, `attempts`, `processed_at`                            |
| `watched_sources`             | `last_checked_at`, `last_item_id`                                       |
| `family_members`              | `whatsapp_phone`, `email` en los adultos                                |
| `calendar_connections`        | Token OAuth por miembro (solo adultos con cuenta propia)                |

---

## 12. Logs útiles

```bash
pnpm dev   # Logs en tiempo real en la terminal
```

| Patrón en log                                   | Qué indica                                  |
| ----------------------------------------------- | ------------------------------------------- |
| `[supervisor] routing to calendar`              | Routing correcto al subagente               |
| `[gmail-poller] source <id> list error 401`     | Token expirado o inválido                   |
| `[gmail-poller] source <id> error: ...`         | Error general del poller                    |
| `[web-scraper] LLM extraction failed`           | El LLM no pudo extraer eventos              |
| `[web-scraper] <url> responded 403`             | El sitio bloquea scrapers                   |
| `[cron/pump] event <id> failed`                 | Error procesando un evento del outbox       |
| `[automation] event type "..." not yet handled` | Tipo de evento sin handler (placeholder)    |
| `No household found`                            | `Thread.householdId` es null                |
`Thread.householdId` es null  |
| `handleInboxEmail: no household configured` | Falta household en la función de resolución |

---

## 13. Problemas comunes

| Problema | Causa | Solución |
|---|---|---|
| El poller dice `gmail: 0` aunque hay emails | Label incorrecto o token sin scope `gmail.readonly` | Verificar `config.label` en `watched_sources`; re-autorizar con `pnpm google-calendar:token` |
| Poller no corre para el household | No hay `watched_sources` con `enabled=true` | Crear al menos una fila (sección 2.3 o 2.4) |
| Email del Gmail poller re-procesado siempre | `last_item_id` en null | Es esperado en la primera corrida; después queda guardado |
| Web scraper no re-chequea | `last_checked_at` < 24h | Resetear con `UPDATE watched_sources SET last_checked_at = null` |
| `action_proposals` siempre en PENDING | Email con datos incompletos o ambiguos | El LLM evalúa `confidence < 0.9` → correcto |
| Reminder no llega por WhatsApp | `whatsapp_phone` null en el miembro | Cargar el número en Prisma Studio |
| Reminder no llega por email | `email` null o `RESEND_API_KEY` no seteado | Cargar email en miembro + agregar la API key |
| `prisma:generate` EPERM en Windows | DLL bloqueada por `pnpm dev` corriendo | Detener el servidor, generar, reiniciar |
| WhatsApp 401 | `WHATSAPP_ACCESS_TOKEN` expirado | Regenerar en Meta Developer (usar System User token que no expira) |
| ngrok connection reset | Free tier reinicia | Actualizar Callback URL en Meta y reiniciar ngrok |
