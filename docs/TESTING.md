# Guía de Testing — Family Copilot

## Requisitos previos

```bash
docker compose up -d   # Postgres (5434) + MinIO (9000/9001)
pnpm install
pnpm prisma:generate   # Generar Prisma client
pnpm prisma:seed       # Crear datos de prueba (Familia Test)
pnpm dev               # Servidor en http://localhost:3000
```

Variables de entorno mínimas en `.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5434/mydb
OPENAI_API_KEY=sk-...
```

---

## 1. Datos de prueba (seed)

El seed crea todo lo necesario. Ejecutalo una sola vez:

```bash
pnpm prisma:seed
```

Imprime los IDs al finalizar:

```
��� Household ID: <id>
��� Thread ID:    <thread-uuid>
��� Augusto ID:   <id>   → PADRE, isMinor=false, color=#3B82F6
��� Pilar ID:     <id>   → MADRE, isMinor=false, color=#EC4899
��� Violeta ID:   <id>   → HIJA,  isMinor=true,  color=#8B5CF6
��� Paulina ID:   <id>   → HIJA,  isMinor=true,  color=#F59E0B
��� Alma ID:      <id>   → HIJA,  isMinor=true,  color=#10B981
```

URL directa al thread: `http://localhost:3000/thread/<thread-uuid>`

Para resetear los datos de prueba:

```bash
pnpm prisma:seed:reset && pnpm prisma:seed
```

---

## 2. Canal web

Abrí el thread generado por el seed: `http://localhost:3000/thread/<thread-uuid>`

### 2.1 Agente general

| Input | Comportamiento esperado |
|-------|------------------------|
| `hola` | Saludo del agente general |
| `¿qué podés hacer?` | Lista de capacidades del supervisor |
| `¿quiénes somos?` | Rutea a `family`, llama `get_family_context`, lista miembros |

---

### 2.2 Subagente calendar — Crear evento simple (1 participante)

```
Agendá dentista para Paulina el martes a las 17
```

**Flujo esperado (tool calls):**
1. `find_family_member("Paulina")` → devuelve `{ id, name, isMinor: true }`
2. `check_conflicts({ participantIds: ["<paulina-id>"], startDateTime: "...", endDateTime: "..." })` → `{ hasConflicts: false }`
3. `get_member_calendars({ memberId: "<paulina-id>" })` → `{ calendars: [] }` (menor sin GCal)
4. `create_family_event({ memberId: "<paulina-id>", memberCalendarId: null, eventType: "MEDICAL", ... })`

**Respuesta esperada:**
```
✅ Agendé dentista para Paulina el martes 7 de abril a las 17:00
```

**Verificar en Prisma Studio:**
- Tabla `calendar_events`: registro con `member_id` de Paulina, `event_type = MEDICAL`
- Tabla `calendar_event_participants`: fila con `event_id` y `member_id` de Paulina, `role = PARTICIPANT`

---

### 2.3 Subagente calendar — Evento con responsable

```
Agendá pediatra para Alma el jueves a las 16, la lleva Pilar
```

**Flujo esperado:**
1. `find_family_member("Alma")` y `find_family_member("Pilar")`
2. `check_conflicts({ participantIds: ["<alma-id>", "<pilar-id>"], ... })` → chequea ambas simultáneamente
3. `get_member_calendars({ memberId: "<pilar-id>" })` → adulta, puede tener calendarios
4. `create_family_event({ memberId: "<alma-id>", responsibleMemberId: "<pilar-id>", participantIds: ["<alma-id>", "<pilar-id>"], ... })`

**Verificar en Prisma Studio:**
- `calendar_events`: `member_id = alma`, `responsible_member_id = pilar`
- `calendar_event_participants`: 2 filas — Alma con `role = PARTICIPANT`, Pilar con `role = RESPONSIBLE`

---

### 2.4 Subagente calendar — Evento con múltiples participantes

```
Agendá reunión familiar el sábado a las 11, van Augusto, Pilar y Violeta
```

**Flujo esperado:**
1. `find_family_member` × 3 (Augusto, Pilar, Violeta)
2. `check_conflicts({ participantIds: ["<augusto-id>", "<pilar-id>", "<violeta-id>"], ... })`
3. `get_member_calendars` del organizador (Augusto o quien lo crea)
4. `create_family_event({ participantIds: ["<augusto-id>", "<pilar-id>", "<violeta-id>"], eventType: "FAMILY", ... })`

**Verificar en Prisma Studio:**
- `calendar_event_participants`: 3 filas para el mismo `event_id`

---

### 2.5 Subagente calendar — Conflicto detectado

Primero creá el dentista de Paulina (test 2.2). Luego:

```
Agendá reunión el martes a las 17
```

**Flujo esperado:**
1. `check_conflicts(...)` → `{ hasConflicts: true, count: 1, conflicts: [{ title: "dentista", ... }] }`
2. El agente **NO crea el evento** — informa el conflicto y propone alternativas

**Respuesta esperada:**
```
⚠️ Conflicto con "dentista" para Paulina (martes 17:00-18:00). ¿Buscamos otro horario?
```

---

### 2.6 Subagente calendar — Buscar hueco libre para varios

```
¿Cuándo están libres Augusto y Pilar para una reunión de 2 horas esta semana?
```

**Flujo esperado:**
1. `find_family_member` × 2
2. `find_free_slots({ participantIds: ["<augusto-id>", "<pilar-id>"], durationMinutes: 120, ... })`
3. Retorna slots donde ambos estén libres simultáneamente

---

### 2.7 Subagente calendar — Listar eventos de un integrante como participante

```
¿Qué tiene Pilar esta semana, incluyendo eventos donde la llevan como responsable?
```

**Esperado:** llama `list_family_events({ memberId: "<pilar-id>", includeAsParticipant: true })`

---

### 2.8 Subagente calendar — Actualizar evento

```
Mové el dentista de Paulina a las 18
```

1. `list_family_events` para encontrar el evento
2. `update_family_event({ eventId: "...", startDateTime: "...T18:00:00", endDateTime: "...T19:00:00" })`
3. Si `needsExternalSync=true` → llama MCP tool de Google Calendar

---

### 2.9 Subagente calendar — Cancelar evento

```
Cancelá el dentista de Paulina del martes
```

1. `list_family_events` 
2. `update_family_event({ status: "CANCELLED" })` (o `delete_family_event`)

---

### 2.10 Subagente recipe

```
¿Qué puedo cocinar esta noche?
```
```
Guardá la receta de tarta de manzana: harina, azúcar, manzanas, huevos. Tiempo: 45 minutos
```

---

### 2.11 Subagente shopping

```
Creá una lista de compras con leche, pan y frutas
```

---

### 2.12 Subagente reminder

```
Recordame comprar medicamentos el viernes a las 10
```

---

### 2.13 Tool approval (aprobación manual)

Con `approveAllTools = false` en la UI:

```
¿qué tengo esta semana?
```

- Antes de ejecutar el tool aparece el botón de aprobación
- **Aprobar** → el agente continúa
- **Rechazar** → el agente responde sin usar el tool

---

## 3. Canal WhatsApp — via ngrok

### 3.1 Setup ngrok

```bash
ngrok http 3000
# Copiá la URL pública, ej: https://abc123.ngrok.io
```

### 3.2 Variables de entorno WhatsApp

Agregar al `.env` y **reiniciar** `pnpm dev`:

```env
WHATSAPP_PHONE_NUMBER_ID=<id del número en Meta Developer>
WHATSAPP_ACCESS_TOKEN=<system user token de Meta>
WHATSAPP_VERIFY_TOKEN=family-copilot-test
WHATSAPP_APP_SECRET=<app secret de la app de Meta>
```

### 3.3 Configurar webhook en Meta Developer

1. Ir a [developers.facebook.com](https://developers.facebook.com) → tu app → WhatsApp → Configuration
2. En "Webhook":
   - **Callback URL**: `https://abc123.ngrok.io/api/whatsapp/webhook`
   - **Verify Token**: el mismo valor que `WHATSAPP_VERIFY_TOKEN`
3. Suscribir al campo `messages`

Meta hace un `GET` con `hub.challenge` → Next.js responde con el challenge → verificación ✅

### 3.4 Vincular tu número de WhatsApp al seed

Para que los mensajes lleguen al hogar de prueba, el número desde el que enviás debe estar en un `FamilyMember`.

En Prisma Studio (`http://localhost:5555`):
- Tabla `family_members` → editar Augusto o Pilar
- Campo `whatsapp_phone`: tu número **con código de país sin `+`** (ej: `59899123456`)

### 3.5 Tests de calendario via WhatsApp

Enviá desde tu número registrado:

| Mensaje | Comportamiento esperado |
|---------|------------------------|
| `hola` | Si es primer contacto: bienvenida + hogar auto-creado. Si ya existe: saludo normal |
| `¿qué podés hacer?` | Lista de capacidades |
| `¿tengo algo esta semana?` | Rutea a calendar → llama `list_family_events` |
| `agendá dentista para Paulina el martes a las 17` | Flujo completo: find_member → check_conflicts → create_event |
| `¿cuándo están libres Augusto y Pilar mañana?` | Llama `find_free_slots` con ambos participantIds |
| `¿qué tiene Violeta esta semana incluyendo donde es participante?` | `list_family_events` con `includeAsParticipant: true` |

### 3.6 Verificar notificación WhatsApp al crear evento

Condiciones:
- `FamilyMember` con `whatsappPhone` configurado
- `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_ACCESS_TOKEN` en `.env`

```
agendá pediatra para Alma el jueves a las 16, la lleva Pilar
```

Comportamiento esperado — llega WhatsApp a todos los miembros con teléfono:
```
��� Nuevo evento agendado
*Pediatra*
��� jueves, 9 de abril a las 16:00
��� Para: Alma
��� Responsable: Pilar
```

### 3.7 Auto-provisioning (primer contacto)

Enviá desde un número **NO registrado** en ningún `FamilyMember`.

Comportamiento esperado:
1. Se crea automáticamente un `Household` "Mi familia"
2. Se crea un `FamilyMember` "Administrador" con ese número como `whatsappPhone`
3. Se recibe mensaje de bienvenida

Verificar en Prisma Studio: nuevo `Household` y `FamilyMember` creados.

---

## 4. Verificación en base de datos

```bash
pnpm prisma:studio   # http://localhost:5555
```

| Tabla | Qué verificar |
|-------|---------------|
| `calendar_events` | `member_id`, `responsible_member_id`, `created_by_member_id`, `event_type`, `all_day` |
| `calendar_event_participants` | Una fila por participante, `role` y `rsvp_status` correctos |
| `member_calendars` | Calendarios configurados de cada adulto (vacío si no se configuró OAuth) |
| `household_permissions` | Permisos entre miembros (vacío por default — se crean manualmente o via UI futura) |
| `reminders` | `channel`, `minutes_before`, `sent` |
| `family_members` | `is_minor`, `color`, `linked_user_id` |
| `households` | `owner_user_id` (null hasta implementar auth) |

---

## 5. Logs útiles para debugging

```bash
pnpm dev   # Ver logs en tiempo real
```

| Log | Qué indica |
|-----|------------|
| `[supervisor] routing to calendar` | Supervisor ruta correctamente |
| `Delegated to calendar agent.` | ACK del transfer |
| `[notifyEventCreated]` | Errores de notificación WhatsApp |
| `No household found` | Falta household vinculado al thread |
| `[buildParticipantFilter]` | Debug de conflictos multi-participante |

Para debug del grafo de LangGraph, agregar temporalmente en `supervisor.ts`:

```typescript
console.log("Supervisor state:", state.messages.map((m) => m._getType()));
```

---

## 6. Problemas comunes

| Problema | Causa probable | Solución |
|----------|---------------|----------|
| El agente no responde | Sin household vinculado al thread | El seed lo vincula automáticamente. Si es un thread nuevo, linkealo en Prisma Studio |
| "No hay hogar configurado" | `householdId` null en el subagente | Verificar FK en `Thread.householdId` |
| `check_conflicts` no detecta conflicto para el responsable | Viejo código — sin `participantIds` | Asegurate de pasar el array completo de IDs |
| `create_family_event` no crea participantes | `participantIds` no se pasa | El agente debe incluirlos; revisar el prompt |
| `syncTarget.required=true` pero no fue a GCal | `memberCalendarId` null → solo app | Configurar `MemberCalendar` para el adulto en Prisma Studio |
| Tool approval loop infinito | `approveAllTools=false` requiere aprobar | Activar `approveAllTools` en UI o aprobar manualmente |
| WhatsApp 401 | `WHATSAPP_ACCESS_TOKEN` expirado | Regenerar en Meta Developer |
| ngrok connection reset | Free tier reinicia | Actualizar Callback URL en Meta |
| `prisma:generate` EPERM | DLL bloqueada por `pnpm dev` corriendo | Detener el servidor, generar, reiniciar |
