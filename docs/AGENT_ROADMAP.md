# Agent Architecture Roadmap

> **Fecha:** Abril 2026  
> **Estado actual:** 7 agentes (supervisor, family, calendar, reminder, recipe, shopping, general)  
> **Estado objetivo:** 8 agentes con responsabilidades bien delimitadas

---

## Resumen ejecutivo de cambios

| Agente actual | Agente destino | Tipo de cambio                                          |
| ------------- | -------------- | ------------------------------------------------------- |
| `supervisor`  | `supervisor`   | Refine: solo routing, sin lógica de dominio             |
| `family`      | `family`       | Redefine: solo memoria/perfiles estructurados           |
| `general`     | `inbox`        | Renombrar + redefinir: ingesta de fuentes externas      |
| `calendar`    | `calendar`     | Refine: solo CRUD de eventos, **delegar OCR a `inbox`** |
| `reminder`    | `reminder`     | Refine: delivery engine de notificaciones               |
| `recipe`      | `recipe`       | Refine: output estructurado `ProductIntentItem[]`       |
| `shopping`    | `shopping`     | Refine: consume solo payloads estructurados             |
| _(ninguno)_   | `library`      | **NUEVO**: RAG, PDFs, documentos, tutor educativo       |

---

## Problema actual: OCR en Calendar

El `calendar` agent hoy lee imágenes/flyers directamente a través de herramientas OCR o análisis de imagen. Esto está mal delimitado porque:

- `calendar` debería solo manejar CRUD de eventos
- La extracción de datos desde imágenes/PDFs/emails es responsabilidad del agente `inbox`
- El `inbox` devuelve `EventCandidate[]` → `calendar` los confirma y agenda

**Fix concreto:** El MCP tool de análisis de imagen/OCR pasa de `calendar` → `inbox`.

---

## Contratos entre agentes (payload contracts)

Antes de implementar cada agente, estos tipos son la columna vertebral del sistema:

```typescript
// src/types/agent-contracts.ts

/** inbox → calendar */
type EventCandidate = {
  title: string;
  memberId?: string;
  startAt: string; // ISO 8601
  endAt?: string;
  location?: string;
  source: "email" | "web" | "pdf" | "image" | "manual";
  confidence: number; // 0–1
  requiresConfirmation: boolean;
  notes?: string;
};

/** recipe → shopping */
type ProductIntentItem = {
  category: "grocery" | "clothing" | "school" | "home" | "pharmacy";
  canonicalName: string;
  quantity: number;
  unit: "unit" | "kg" | "g" | "l" | "ml" | "pack";
  memberId?: string;
  preferredBrands?: string[];
  substitutesAllowed: boolean;
  notes?: string;
};

/** calendar → reminder */
type NotificationRequest = {
  type: "reminder" | "digest" | "urgent";
  targetMembers: string[];
  title: string;
  message: string;
  sendAt: string; // ISO 8601
  channels: ("push" | "email" | "whatsapp")[];
  eventId?: string;
};

/** supervisor → library */
type StudyRequest = {
  memberId: string;
  subject?: string;
  goal: "explain" | "quiz" | "exercise" | "summary" | "search";
  age?: number;
  sourceDocumentIds?: string[];
  difficulty?: "easy" | "medium" | "hard";
  freeText?: string;
};

/** inbox output (genérico) */
type InboxCandidate =
  | { type: "event_candidate"; data: EventCandidate }
  | { type: "shopping_item_candidate"; data: ProductIntentItem }
  | { type: "document_to_index"; data: DocumentReference }
  | { type: "payment_deadline"; data: PaymentDeadline }
  | { type: "school_notice"; data: SchoolNotice };

type DocumentReference = {
  title: string;
  memberId?: string;
  fileUrl: string;
  mimeType: string;
  source: string;
};
```

---

## Plan por agente

---

### 1. `supervisor` — Orquestador principal

**Archivo:** `src/lib/agent/subagents/` _(no tiene subagent propio, en `supervisor.ts`)_  
**Estado:** Bien encaminado, necesita ajuste de límites

#### Responsabilidades (objetivo)

- Clasificar intención del usuario
- Cargar contexto del caller (`callerId`, `callerRole`)
- Decidir qué agente(s) usar (multi-intent ya funciona)
- Combinar respuestas de múltiples subagentes
- **NO** contener lógica de dominio (fechas, recetas, etc.)

#### Cambios por stage

**Stage 1 — Inmediato**

- [ ] Agregar `inbox` y `library` al listado de `buildTransferTools()` en `supervisor.ts`
- [ ] Actualizar `SUPERVISOR_PROMPT` con los 8 agentes y sus casos de uso
- [ ] Agregar reglas de routing para: "documentos/PDFs" → `library`, "emails/correos/flyers" → `inbox`

**Stage 2 — Mediano plazo**

- [ ] Mover toda lógica de routing compleja a una función `classifyIntent()` separada
- [ ] Definir Approval Node global para acciones sensibles (ver sección Aprobaciones)

#### Reglas de routing nuevas a agregar en prompt

```
inbox    → emails, correos del colegio, PDFs adjuntos, imágenes de flyers, circulares, páginas web
library  → preguntas sobre documentos, ejercicios, explicaciones, quizzes, resumenes de libros/apuntes
```

---

### 2. `family` — Family Memory / Profile Agent

**Archivos:** `src/lib/agent/subagents/family.ts`, `src/lib/agent/prompts/family.ts`  
**Estado:** Funcional pero con alcance demasiado amplio

#### Responsabilidades (objetivo)

SOLO es la "fuente de verdad" de la familia:

- Perfiles de miembros (edad, colegio, actividades, horario base)
- Preferencias alimentarias y alergias
- Restricciones y constraints (`ALLERGY`, `DISLIKE`, `MEDICATION`, `DIET`, `SCHEDULE_RULE`)
- Preferencias de compra (tiendas, marcas)
- Relaciones entre miembros

#### LO QUE NO DEBE HACER

- Parsear emails o PDFs → es `inbox`
- Hacer RAG o Q&A sobre documentos → es `library`
- Crear eventos complejos → es `calendar`
- Armar carritos → es `shopping`

#### Cambios por stage

**Stage 1 — Inmediato**

- [ ] Actualizar `FAMILY_AGENT_PROMPT` para limitar explícitamente el alcance
- [ ] Agregar sección "FUERA DE MI ALCANCE" con redirecciones explícitas al resto de agentes
- [ ] Revisar si hay lógica de análisis de documentos mezclada → moverla a `inbox`

**Stage 2 — Mediano plazo**

- [ ] Agregar tool `get_family_context_for_agent()` con output tipado como `FamilyContext` para que otros agentes lo consuman de forma estructurada
- [ ] Evaluar Prisma schema para agregar campos que hoy no existen: `preferredBrands`, `clothingSize`, `schoolName`, `extracurricularActivities`

**Schema Prisma a agregar (Stage 2)**

```prisma
model FamilyMember {
  // ... campos existentes ...
  schoolName       String?
  schoolGrade      String?
  clothingSize     String?
  shoeSize         String?
  extracurricular  String[]
  preferredBrands  String[]
}
```

---

### 3. `calendar` — Agenda / Eventos / Disponibilidad

**Archivos:** `src/lib/agent/subagents/calendar.ts`, `src/lib/agent/prompts/calendar.ts`, `src/lib/tools/calendar/index.ts`  
**Estado:** Bien implementado, problema puntual de OCR

#### Responsabilidades (objetivo)

- CRUD de eventos (crear, editar, listar, eliminar)
- Detectar conflictos entre participantes
- Encontrar franjas libres
- Sincronizar con Google Calendar
- Consumir `EventCandidate` validados desde `inbox`

#### PROBLEMA ACTUAL: OCR / análisis de imagen

El agente calendar hoy recibe imágenes (flyers, fotos de circulares) y las analiza directamente.

**Fix:**

1. Esa tarea pasa a `inbox` (es quien extrae datos de fuentes externas)
2. `inbox` devuelve `EventCandidate[]` con `requiresConfirmation: true`
3. `calendar` recibe el candidate ya estructurado y procede con CRUD

#### Cambios por stage

**Stage 1 — Inmediato** ⚠️ PRIORIDAD ALTA

- [ ] Remover del `CALENDAR_AGENT_PROMPT` cualquier instrucción de analizar imágenes o hacer OCR
- [ ] Agregar al prompt: "Si recibes una imagen o documento, delegá a `inbox` primero"
- [ ] En `filterCalendarTools()`: verificar que no haya tools de visión/OCR filtradas hacia el agente calendar. Si las hay, moverlas a inbox.

**Stage 2 — Mediano plazo**

- [ ] Agregar herramienta `confirm_event_candidate(candidate: EventCandidate)` que valida el candidate de inbox y crea el evento
- [ ] Agregar regla de aprobación: eventos creados desde `EventCandidate` con `confidence < 0.85` requieren HITL

**Stage 3 — Largo plazo**

- [ ] Construir conector para iCal import (`.ics` files)
- [ ] Soporte multi-calendario por miembro

---

### 4. `reminder` — Delivery Engine de Notificaciones

**Archivos:** `src/lib/agent/subagents/reminder.ts`, `src/lib/agent/prompts/reminder.ts`, `src/lib/tools/reminders/index.ts`  
**Estado:** Bien delimitado por el prompt actual (tiene el `STRICT ISOLATION` bien definido)

#### Responsabilidades (objetivo)

- Crear/listar/completar/desestimar recordatorios
- Enviar notificaciones (push, email, WhatsApp)
- Digest diario/semanal
- Escalado si nadie responde
- Horarios ideales de aviso

#### LO QUE NO DEBE HACER (ya definido en prompt)

- Lógica profunda de calendario
- Parsing de emails o fechas desde texto libre sin estructura

#### Cambios por stage

**Stage 1 — Inmediato**

- [ ] Ningún cambio urgente (el prompt ya tiene buen scope)

**Stage 2 — Mediano plazo**

- [ ] Agregar tool `create_reminder_from_event(eventId)` para que `calendar` pueda disparar reminders automáticos
- [ ] Agregar tipo `NotificationRequest` como input estructurado desde otros agentes
- [ ] Soporte para digest semanal/diario

**Stage 3 — Largo plazo**

- [ ] Integración real con push notifications (web push / FCM)
- [ ] Canal WhatsApp (ya existe parcialmente)
- [ ] Retry logic y escalado

---

### 5. `recipe` — Meal Planning / Ingredientes Estructurados

**Archivos:** `src/lib/agent/subagents/recipe.ts`, `src/lib/agent/prompts/recipe.ts`, `src/lib/tools/recipes/index.ts`  
**Estado:** Funcional, necesita cambio en el output

#### Responsabilidades (objetivo)

- Sugerir recetas
- Meal planning semanal
- Adaptar por restricciones del miembro
- **Generar `ProductIntentItem[]`** (NO comprar directamente)

#### CAMBIO CLAVE: el output de receta debe ser estructurado

Hoy recipe puede pasar ingredientes en texto libre a shopping. Debe generar `ProductIntentItem[]`.

#### Cambios por stage

**Stage 1 — Inmediato**

- [ ] Actualizar `RECIPE_AGENT_PROMPT` para que al terminar sugiera ingredientes en formato estructurado antes de transferir a shopping
- [ ] Clarificar en el prompt: "recipe genera ingredients, shopping los compra"

**Stage 2 — Mediano plazo**

- [ ] Agregar tool `create_ingredient_intent(recipeId): ProductIntentItem[]` que normaliza los `RecipeIngredient` al formato universal
- [ ] `generateGroceryListFromRecipesTool` ya hace algo similar, formalizar el contrato de tipo

**Prisma schema a revisar**

```prisma
model RecipeIngredient {
  // ya existe, pero revisar que tenga:
  category  String?   // "grocery" | "dairy" | etc.
  unit      String?   // normalizado: "g", "kg", "unit", etc.
}
```

---

### 6. `shopping` — Resolución de Productos / Carrito

**Archivos:** `src/lib/agent/subagents/shopping.ts`, `src/lib/agent/prompts/shopping.ts`, `src/lib/tools/shopping/index.ts`  
**Estado:** Funcional, necesita capa de input estructurado

#### Responsabilidades (objetivo)

- Recibir `ProductIntentItem[]` (de recipe, family, inbox, supervisor)
- Normalizar productos
- Armar carrito
- Marcar items comprados
- (Futuro) Comparar tiendas, buscar equivalentes

#### CAMBIO CLAVE: debe consumir `ProductIntentItem` no solo texto libre

#### Cambios por stage

**Stage 1 — Inmediato**

- [ ] Actualizar `SHOPPING_AGENT_PROMPT` para que acepte `ProductIntentItem[]` como input preferido
- [ ] Agregar en prompt las fuentes válidas: "puede recibir items desde recipe, family o inbox"

**Stage 2 — Mediano plazo**

- [ ] Agregar tool `add_product_intent_items(items: ProductIntentItem[])` que crea o actualiza la lista activa desde el tipo universal
- [ ] Definir `type ProductIntentItem` en `src/types/agent-contracts.ts`

**Stage 3 — Largo plazo**

- [ ] Merchant connectors (scrapers por tienda)
- [ ] Comparación de precios
- [ ] Link de checkout
- [ ] Sustituciones automáticas (con HITL para el primero)

---

### 7. `general` → renombrar a `inbox` — Ingesta de Fuentes Externas

**Archivos actuales:** `src/lib/agent/subagents/general.ts`, `src/lib/agent/prompts/general.ts`  
**Estado:** Cajón de sastre genérico — DEBE REDEFINIRSE

#### ESTE ES EL CAMBIO MÁS IMPORTANTE

Hoy `general` es un fallback genérico. Debe convertirse en el agente que extrae información de fuentes externas y produce candidatos estructurados.

#### Responsabilidades (objetivo)

- Leer y parsear emails (Gmail/Outlook)
- Analizar PDFs adjuntos
- **Analizar imágenes con OCR** (actualmente mal ubicado en `calendar`)
- Scraping de páginas del colegio
- Leer circulares, flyers, comunicados
- Detectar `.ics` en adjuntos
- Producir `InboxCandidate[]` (NO tomar decisiones finales)

#### LO QUE NO DEBE HACER

- Crear eventos directamente (produce `EventCandidate`, calendar decide)
- Comprar (produce `ProductIntentItem`, shopping decide)
- Responder preguntas de dominio (es `family`, `library`, etc.)

#### Cambios por stage

**Stage 1 — Inmediato** ⚠️ PRIORIDAD ALTA

- [ ] Renombrar archivo: `general.ts` → `inbox.ts` (subagent + prompt)
- [ ] Actualizar `supervisor.ts` para registrar `inbox` en lugar de `general`
- [ ] Reescribir `INBOX_AGENT_PROMPT` (reemplaza `GENERAL_AGENT_PROMPT`) con el nuevo rol
- [ ] Recibir los tools de OCR/visión que estaban en calendar

**Stage 2 — Mediano plazo**

- [ ] Agregar tools:
  - `analyze_image_content(imageUrl): InboxCandidate[]` (OCR + extracción)
  - `parse_pdf_document(fileUrl): InboxCandidate[]`
  - `extract_from_email(emailId): InboxCandidate[]`
- [ ] Output siempre como candidatos estructurados con `confidence` y `requiresConfirmation`

**Stage 3 — Largo plazo**

- [ ] Integración Gmail MCP para leer emails
- [ ] Web scraper para páginas del colegio
- [ ] Parser de `.ics` desde adjuntos
- [ ] Procesamiento de WhatsApp forwards

#### Renombrado de archivos necesario

```
src/lib/agent/subagents/general.ts  →  src/lib/agent/subagents/inbox.ts
src/lib/agent/prompts/general.ts    →  src/lib/agent/prompts/inbox.ts
```

---

### 8. `library` — RAG / Documentos / Tutor Educativo _(NUEVO)_

**Archivos a crear:**

- `src/lib/agent/subagents/library.ts`
- `src/lib/agent/prompts/library.ts`
- `src/lib/tools/library/index.ts`

**Estado:** No existe. Debe crearse.

#### Responsabilidades (objetivo)

- Indexar documentos (PDFs, libros, apuntes)
- RAG sobre documentos indexados
- Responder preguntas específicas sobre documentos
- Resumir contenido
- Explicar según edad del miembro
- Generar ejercicios y quizzes
- Sugerir material de estudio

#### Casos de uso concretos

- "Explicame el capítulo 3 del libro de ciencias de Sofi"
- "Hacé 5 ejercicios de fracciones para Tomi de 8 años"
- "¿Qué materiales hay que llevar según el PDF del colegio?"
- "Resumí este comunicado"

#### Cambios por stage

**Stage 1 — MVP Básico** _(prioridad media-alta)_

- [ ] Crear `src/lib/agent/subagents/library.ts`
- [ ] Crear `src/lib/agent/prompts/library.ts`
- [ ] Crear `src/lib/tools/library/index.ts` con tools básicos:
  - `index_document(fileUrl, title, memberId?): DocumentReference`
  - `query_document(documentId, question): string`
  - `summarize_document(documentId): string`
  - `list_documents(memberId?): DocumentReference[]`
- [ ] Agregar `library` en `supervisor.ts` como transfer target

**Stage 2 — Tutor Educativo**

- [ ] Agregar tools:
  - `generate_exercises(topic, age, difficulty, count): Exercise[]`
  - `generate_quiz(documentId, count): Quiz[]`
  - `explain_concept(concept, age): string`
- [ ] Input tipado vía `StudyRequest`

**Stage 3 — Vector DB / embeddings**

- [ ] Integrar vector DB (pgvector en Postgres o Pinecone)
- [ ] Chunking automático de PDFs
- [ ] Embeddings por documento
- [ ] Semantic search cross-documents

**Prisma schema a agregar (Stage 1)**

```prisma
model Document {
  id          String   @id @default(cuid())
  householdId String
  title       String
  fileUrl     String
  fileKey     String
  mimeType    String
  memberId    String?
  subject     String?
  createdAt   DateTime @default(now())
  chunks      DocumentChunk[]
  household   Household @relation(fields: [householdId], references: [id])
  member      FamilyMember? @relation(fields: [memberId], references: [id])
}

model DocumentChunk {
  id         String   @id @default(cuid())
  documentId String
  content    String
  chunkIndex Int
  embedding  Float[]  // pgvector cuando se active
  document   Document @relation(fields: [documentId], references: [id])
}
```

---

## Flujo actualizado del grafo LangGraph

```
User Input
  ↓
Supervisor
  ├── family    (load structured memory / profile data)
  ├── inbox     (email, PDF, image, web extraction → candidates)
  ├── library   (RAG, Q&A, exercises, summaries)
  ├── calendar  (event CRUD, consume EventCandidate from inbox)
  ├── reminder  (notifications, consume NotificationRequest)
  ├── recipe    (meal planning, produce ProductIntentItem[])
  └── shopping  (cart building, consume ProductIntentItem[])
       ↓
  [Approval Node] ← para acciones sensibles
       ↓
  Execute
       ↓
  Persist (LangGraph checkpoints)
```

---

## Approval Node — Acciones que requieren HITL

Las siguientes acciones SIEMPRE deben pedir confirmación humana:

| Acción                                                      | Agente   | Motivo                          |
| ----------------------------------------------------------- | -------- | ------------------------------- |
| Crear evento desde `EventCandidate` con `confidence < 0.85` | calendar | Puede haber error de extracción |
| Crear evento en calendario de otro miembro                  | calendar | Privacidad / autorización       |
| Abrir carrito o checkout final                              | shopping | Acción monetaria                |
| Marcar compra automáticamente                               | shopping | Estado financiero               |
| Enviar recordatorio masivo a todos                          | reminder | Spam familiar                   |
| Reemplazar producto automáticamente                         | shopping | Puede haber preferencias        |
| Interpretar email ambiguo (`confidence < 0.7`)              | inbox    | Alta incertidumbre              |
| Indexar documento ajeno a un miembro                        | library  | Privacidad por miembro          |
| Cualquier modificación de datos de miembro                  | family   | Datos sensibles de familia      |

---

## Prioridades de implementación

### Semana 1 — Correcciones críticas de scope

1. **Fix OCR en Calendar** — Remover instrucciones de análisis de imagen del prompt de `calendar`
2. **Redefinir `family` prompt** — Acotar a solo memoria estructurada
3. **Renombrar `general` → `inbox`** en archivos y supervisor

### Semana 2 — Tipos compartidos

4. **Crear `src/types/agent-contracts.ts`** con todos los contratos de payload
5. **Actualizar prompts** de todos los agentes para referenciar los contratos

### Semana 3 — Integración inbox

6. **Crear tools de `inbox`** (image analysis, PDF parse)
7. **Conectar calendar** para consumir `EventCandidate` desde inbox

### Semana 4 — Nuevo agente library (MVP)

8. **Crear `library` subagent** con tools básicos de indexado y query
9. **Agregar `library`** como transfer target en supervisor
10. **Agregar modelos Prisma** `Document` y `DocumentChunk`

### Mes 2 — Structured outputs y Merchant connectors

- `ProductIntentItem` end-to-end (recipe → shopping)
- `NotificationRequest` (calendar → reminder)
- MVP de Merchant connectors para shopping
- Digest semanal en reminder

### Mes 3 — Vector DB y Tutor

- pgvector en Postgres
- Embeddings automáticos en library
- Generador de ejercicios con contexto por miembro
- Quiz generator desde documentos indexados

---

## Diagrama de dependencias entre agentes

```
          ┌─────────────────────────────────────────────┐
          │                 SUPERVISOR                   │
          └──┬──────┬──────┬──────┬──────┬──────┬──────┘
             │      │      │      │      │      │
           family inbox library calendar reminder recipe shopping
             │      │                │      ↑       │       ↑
             │      │                │      │       │       │
             │      └─(EventCandidate)─────━┘       │       │
             │      └─(ProductIntentItem)────────────────━━━┘
             │                       └─(NotificationRequest)─┘
             └──(FamilyContext)───────┤
                                      └── (todos los agentes consultan family)
```

---

## Notas de implementación

### Sobre el renombrado de `general` → `inbox`

El renombrado afecta estos archivos:

1. `src/lib/agent/subagents/general.ts` → crear `inbox.ts` (no borrar `general.ts` hasta Stage 2)
2. `src/lib/agent/prompts/general.ts` → crear `inbox.ts`
3. `src/lib/agent/supervisor.ts` → `buildTransferTools()` y `buildSupervisorGraph()`
4. `src/lib/agent/prompts/supervisor.ts` → tabla de agentes en el prompt

Recomendación: crear `inbox.ts` como wrapper/alias de `general.ts` en Stage 1, y hacer el renombrado completo en Stage 2 para minimizar riesgo.

### Sobre el `library` agent y vector DB

Para el MVP (Stage 1), NO es necesario implementar embeddings. Se puede:

- Guardar documentos en MinIO (ya existe S3Client)
- Guardar metadata en Prisma (tabla `Document`)
- Usar el LLM directamente para hacer Q&A pasando el texto del documento como contexto

El vector DB con pgvector es un Stage 3 y solo necesario cuando el volumen de chunks supere lo que cabe en contexto.

### Sobre el Approval Node global

Hoy el HITL está implementado en `AgentBuilder` con `approveAllTools: false` en el supervisor principal. Para el Approval Node semántico:

- Crear un nodo `sensitive_action_approval` en el grafo del supervisor
- Antes de ejecutar acciones de la lista de aprobaciones, redireccionar ahí
- El nodo interrumpe y el frontend muestra el modal de confirmación existente

Esto es una extensión del mecanismo ya existente, no una reescritura.
