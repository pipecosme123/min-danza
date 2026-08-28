# Ronda 2026-08-27 — Cantidad de equipos libre, eventos agrupados ("Congreso"), adelanto del mes siguiente y versículo del mes

**Estado:** implementado, probado (backend 325/325, frontend 155/155) y verificado por QA de punta a punta contra el servidor real. Referencia de contrato para los endpoints nuevos de esta ronda.
**Fecha:** 2026-08-27
**Alcance:** cambio de `teamsNeeded` en `POST /api/months/:id/events` / `PATCH /api/events/:eventId` (complementa `docs/architecture/phase4-schedule-contract.md` §4, que tiene la nota puntual y remite acá para el detalle completo); los 8 endpoints nuevos de eventos agrupados bajo `/api/months/:id/event-groups` y `/api/event-groups/...`; el ajuste a `GET /api/schedule/:year/:month` y `GET /api/schedule/history` para revelar el mes siguiente en los últimos 8 días del mes actual (complementa `docs/architecture/phase5-public-page-contract.md`, que tiene la nota puntual y remite acá); los 4 endpoints nuevos de "versículo del mes" bajo `/api/months/:id/verses` y `/api/verses/:verseId`.

**Naming de este archivo:** no corresponde a una "Fase 8" formal del plan original (el proyecto sigue en Fase 7 "pulido", ver `CLAUDE.md` §Estado) — es una ronda de trabajo acotada con el usuario, documentada como archivo aparte (en vez de una ampliación de un contrato existente, como se hizo con la ronda 2026-08-25 sobre `phase4c-post-publish-edits-contract.md`) porque introduce dos modelos de datos nuevos (`EventGroup`, `VersePassage`) sin relación directa entre sí, que no encajan naturalmente dentro de ningún contrato de fase ya cerrado.

Fuentes: `CLAUDE.md` (secciones "Eventos extraordinarios", "Eventos agrupados (\"Congreso\")", "Versículo del mes", "Finalizar un mes y página pública"), código real verificado línea por línea: `server/src/services/events.service.js`, `server/src/routes/events.routes.js`, `server/src/services/eventGroups.service.js`, `server/src/routes/eventGroups.routes.js`, `server/src/services/publicSchedule.service.js`, `server/src/services/verses.service.js`, `server/src/routes/verses.routes.js`, `server/src/services/bibleSource.service.js`, `server/prisma/schema.prisma`, `server/prisma/migrations/20260825010000_free_teams_needed_event_groups_verses/migration.sql`.

---

## 0. Forma de las respuestas de error

Todos los endpoints de este documento comparten el mismo formato de error que el resto de la API (`server/src/middleware/errorHandler.js`):

```json
{
  "error": {
    "message": "No podés pedir más equipos de los que tiene el mes.",
    "details": { "code": "TEAMSNEEDED_EXCEDE_EQUIPOS", "teamsNeeded": 5, "regularTeamCount": 3 }
  }
}
```

En el resto del documento se abrevia como **`400` `TEAMSNEEDED_EXCEDE_EQUIPOS`** (código HTTP + `details.code`), siguiendo la misma convención que el resto de `docs/architecture/`.

---

## 1. `teamsNeeded` libre en eventos extraordinarios

Endpoints afectados: `POST /api/months/:id/events`, `PATCH /api/events/:eventId` (sin cambios de ruta ni de forma del resto del body — ver `docs/architecture/phase4-schedule-contract.md` §4-5 para el contrato completo de esos endpoints).

**Antes:** `teamsNeeded` solo aceptaba `1` o `2` (`.refine((v) => v === 1 || v === 2, ...)` en `events.routes.js`).

**Ahora:** el schema Zod solo exige `teamsNeeded >= 1` (entero) — el tope real depende de cuántos equipos `REGULAR` tenga el mes en particular, así que se valida en el service, no en el schema:

```js
// server/src/services/events.service.js (createEvent y updateEvent, misma lógica en ambos)
const regularTeamCount = await tx.team.count({ where: { monthCycleId, teamType: "REGULAR" } });
if (data.teamsNeeded > regularTeamCount) {
  throw new ValidationError("No podés pedir más equipos de los que tiene el mes.", {
    code: "TEAMSNEEDED_EXCEDE_EQUIPOS",
    teamsNeeded: data.teamsNeeded,
    regularTeamCount,
  });
}
```

- **`400` `TEAMSNEEDED_EXCEDE_EQUIPOS`** — se pidió más equipos de los que tiene el mes. `details: { teamsNeeded, regularTeamCount }`.
- Sin cambios en `EQUIPOS_BLOQUEADOS_EXCEDEN_CUPO` (`updateEvent`, intentar bajar `teamsNeeded` por debajo de la cantidad de asignaciones ya bloqueadas de ese evento).
- Requirió relajar el `CHECK` de base `service_slot_teams_needed_range` → `service_slot_teams_needed_positive` (`teams_needed >= 1`, sin tope superior a nivel de base — ver §5).

---

## 2. Eventos agrupados ("Congreso")

### 2.0 Concepto y modelo

"Congreso" es el ejemplo típico usado para pedir esta funcionalidad, **no** es un tipo hardcodeado en el sistema — cualquier evento con **2 o más fechas distintas**, cada fecha con **uno o más turnos** (hora + uno o más equipos elegidos a mano + uniforme opcional), se modela igual.

```prisma
model EventGroup {
  id           String   @id @default(cuid())
  monthCycleId String   @map("month_cycle_id")
  title        String
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  monthCycle MonthCycle    @relation(fields: [monthCycleId], references: [id], onDelete: Cascade)
  slots      ServiceSlot[]

  @@index([monthCycleId])
  @@map("event_group")
}
```

`ServiceSlot` suma `eventGroupId String? @map("event_group_id")` + relación `eventGroup EventGroup? @relation(fields: [eventGroupId], references: [id], onDelete: Cascade)` (nullable — la inmensa mayoría de los `ServiceSlot` de la app no pertenecen a ningún grupo). Cada "turno" de un Congreso es, por dentro, un `ServiceSlot` normal (`slotType: EXTRAORDINARY`, `title` = título del grupo, `countsTowardBalance: true`) con `eventGroupId` apuntando a su grupo — se reutiliza toda la maquinaria ya existente de `ServiceSlot` (uniforme por turno, `cancelledAt`, `SlotAssignment`, aparición en `GET /api/months/:id/schedule` y en los endpoints públicos) sin duplicar nada.

**Diferencia clave con un evento suelto**: los equipos de un turno de Congreso los elige el administrador **a mano** (uno o más, de una lista de equipos `REGULAR` del mes), nunca se auto-balancean. Se crean directo como `SlotAssignment` con `locked: true` (mismo patrón que ya usa `PATCH /api/assignments/:id` al reasignar a mano — "reasignar siempre fija la asignación"), **sin pasar por `recomputeBalance`**. Igual cuentan al balance del mes porque `countsTowardBalance: true` en el slot: el conteo de `GET /api/months/:id/schedule` es un `groupBy` sobre `SlotAssignment` filtrado por eso, no le importa si la asignación vino del sorteo automático o de la elección manual del admin.

`SLOT_SELECT`/`serializeSlot` (`server/src/services/scheduleGeneration.service.js`, compartidos por todos los endpoints que devuelven un `ServiceSlot`, incluidos los de este documento) suman `eventGroup: { id, title } | null` al DTO de cada slot — así tanto la administración como la página pública pueden agrupar visualmente los turnos de un mismo Congreso sin una consulta aparte.

Todas las escrituras de esta sección usan `assertEditableConsideringFinalization` (`server/src/utils/monthLifecycle.js`): sin restricción en `DRAFT`; en un mes `FINALIZED`, solo si es el actual o uno futuro (**`409` `MES_PASADO`** si ya pasó — mismo criterio que agregar/cancelar/eliminar/editar un evento suelto, ver `docs/architecture/phase4c-post-publish-edits-contract.md`), e invalidan el caché público puntual (`schedule:${year}:${month}`) cuando corresponde.

Auth de las 8 rutas: `requireAuth` + `adminLimiter`, aplicados por ruta (el router se monta en `/`, mezcla `/months/:id/event-groups` con `/event-groups/:id`, mismo patrón que `teams.routes.js`/`events.routes.js`/`verses.routes.js` — ver el comentario de cabecera de `eventGroups.routes.js`).

### 2.1 `POST /api/months/:id/event-groups` — crear el grupo

Body:
```json
{
  "title": "Congreso Nacional 2026",
  "turnos": [
    { "date": "2026-08-14", "startTime": "19:00", "teamIds": ["team_1", "team_2"], "uniformId": "unif_1" },
    { "date": "2026-08-15", "startTime": "09:00", "teamIds": ["team_1"] },
    { "date": "2026-08-15", "startTime": "19:00", "teamIds": ["team_2", "team_3"] }
  ]
}
```

| Campo | Reglas |
|---|---|
| `title` | string, `1..100` |
| `turnos` | array, mínimo **2** elementos a nivel de schema (necesario pero no suficiente — 2 turnos podrían compartir la misma fecha; el mínimo real de "2 fechas distintas" lo valida el service, ver abajo) |
| `turnos[].date` | `"YYYY-MM-DD"`, debe caer dentro del año/mes del `MonthCycle` → si no, **`400` `FECHA_FUERA_DE_MES`** |
| `turnos[].startTime` | `"HH:mm"` 24h |
| `turnos[].teamIds` | array, mínimo 1, sin duplicados, todos `Team` `teamType: REGULAR` del mismo mes → si no, **`400` `EQUIPO_NO_VALIDO`** |
| `turnos[].uniformId` | opcional; debe existir y estar `active: true` → si no, **`400` `UNIFORME_NO_VALIDO`** |

Validaciones del service, en orden:
1. **`404` `Mes no encontrado.`** — el `id` no corresponde a ningún `MonthCycle`.
2. `assertEditableConsideringFinalization` → **`409` `MES_PASADO`** si corresponde.
3. **`409` `HORARIO_NO_GENERADO`** — el mes todavía no tiene ningún `ServiceSlot` (`generate-schedule` no se corrió; agregar un Congreso requiere que el horario base ya exista, mismo criterio que un evento suelto).
4. **`400` `CONGRESO_MINIMO_DOS_FECHAS`** — las fechas *distintas* entre los `turnos` enviados son menos de 2 (`new Set(turnos.map(t => t.date)).size < 2`).
5. Por cada turno: `teamIds`/`uniformId` válidos (tabla de arriba).

**`201`** → el grupo creado con sus turnos ya materializados:
```json
{
  "group": {
    "id": "grp_abc123",
    "title": "Congreso Nacional 2026",
    "slots": [
      {
        "id": "slot_1", "date": "2026-08-14", "startTime": "19:00", "slotType": "EXTRAORDINARY",
        "title": "Congreso Nacional 2026", "teamsNeeded": 2, "countsTowardBalance": true,
        "cancelledAt": null, "uniform": { "id": "unif_1", "name": "Uniforme A", "colorHex": "#1E40AF" },
        "teams": [
          { "id": "team_1", "label": "Equipo 1", "assignmentId": "asg_1", "locked": true },
          { "id": "team_2", "label": "Equipo 2", "assignmentId": "asg_2", "locked": true }
        ],
        "eventGroup": { "id": "grp_abc123", "title": "Congreso Nacional 2026" }
      },
      {
        "id": "slot_2", "date": "2026-08-15", "startTime": "09:00", "slotType": "EXTRAORDINARY",
        "title": "Congreso Nacional 2026", "teamsNeeded": 1, "countsTowardBalance": true,
        "cancelledAt": null, "uniform": null,
        "teams": [ { "id": "team_1", "label": "Equipo 1", "assignmentId": "asg_3", "locked": true } ],
        "eventGroup": { "id": "grp_abc123", "title": "Congreso Nacional 2026" }
      },
      {
        "id": "slot_3", "date": "2026-08-15", "startTime": "19:00", "slotType": "EXTRAORDINARY",
        "title": "Congreso Nacional 2026", "teamsNeeded": 2, "countsTowardBalance": true,
        "cancelledAt": null, "uniform": null,
        "teams": [
          { "id": "team_2", "label": "Equipo 2", "assignmentId": "asg_4", "locked": true },
          { "id": "team_3", "label": "Equipo 3", "assignmentId": "asg_5", "locked": true }
        ],
        "eventGroup": { "id": "grp_abc123", "title": "Congreso Nacional 2026" }
      }
    ]
  }
}
```
(`teamsNeeded` de cada turno = `teamIds.length` de ese turno; los slots quedan ordenados `(date asc, startTime asc)`.)

### 2.2 `GET /api/months/:id/event-groups` — listar los grupos del mes

Sin body. **`200`** → `{ "groups": [ /* mismo shape que el "group" de arriba, uno por cada EventGroup del mes, orden createdAt asc */ ] }`. **`404` `Mes no encontrado.`** si el `id` no existe.

### 2.3 `PATCH /api/event-groups/:groupId` — renombrar el grupo

Body: `{ "title": "Congreso Regional 2026" }` (`title` string, `1..100`, obligatorio).

Renombra el `EventGroup` **y** propaga el `title` a todos sus `ServiceSlot` (denormalizado para no forzar un JOIN en cada lectura de horario). **`200`** → `{ "group": { ...mismo shape de 2.1, título/turnos ya actualizados... } }`. **`404` `EVENTO_AGRUPADO_NO_ENCONTRADO`** si `groupId` no existe.

### 2.4 `POST /api/event-groups/:groupId/turnos` — agregar un turno más

Body: mismo shape que un elemento de `turnos[]` en 2.1 (`date`, `startTime`, `teamIds`, `uniformId?`). Mismas validaciones de fecha/equipos/uniforme que al crear el grupo — **sin** exigir el mínimo de 2 fechas (ese mínimo solo aplica al crear el grupo, no a agregar turnos después).

**`201`** → `{ "slot": { ...mismo shape de un elemento de slots[]... } }`. **`404` `EVENTO_AGRUPADO_NO_ENCONTRADO`** si `groupId` no existe.

### 2.5 `PATCH /api/event-groups/turnos/:slotId` — editar un turno puntual

Body parcial (`date?`, `startTime?`, `teamIds?`, `uniformId?` — al menos un campo, `400` si el body queda vacío tras validar). Si viene `teamIds`, **reemplaza el set completo** de equipos de ese turno (borra todas las `SlotAssignment` existentes y recrea `locked: true` para cada id nuevo, actualiza `teamsNeeded = teamIds.length`) — mismo patrón "reemplaza el roster completo" que ya usa `PATCH /api/teams/:teamId`, **no** es un ajuste incremental.

**`200`** → `{ "slot": { ... } }`. **`404` `TURNO_NO_ENCONTRADO`** si `slotId` no existe o no pertenece a ningún grupo (no es un turno de Congreso).

### 2.6 `DELETE /api/event-groups/turnos/:slotId` — eliminar un turno suelto

Sin body. Borra el `ServiceSlot` (cascada borra sus `SlotAssignment`). Si era el último turno del grupo, borra también el `EventGroup` ya vacío — no quedan grupos huérfanos sin turnos. **No** hay mínimo de 2 turnos después de creado: el mínimo de 2 fechas solo se exige al crear el grupo.

**`200`** → `{ "deleted": true, "groupDeleted": false }` (`groupDeleted: true` si además se eliminó el grupo por quedar vacío). **`404` `TURNO_NO_ENCONTRADO`** si `slotId` no existe o no pertenece a ningún grupo.

### 2.7 `POST /api/event-groups/:groupId/cancel` — cancelar el grupo completo

Sin body. Cancela **todos** los turnos activos del grupo a la vez: cada `ServiceSlot` no cancelado queda `cancelledAt`/`countsTowardBalance: false`, y se le borran sus `SlotAssignment` (cancelar prevalece sobre `locked`, mismo criterio que cancelar un evento suelto). No hay forma de "descancelar".

**`200`** → `{ "group": { ...turnos ya reflejando cancelledAt no nulo... } }`. **`404` `EVENTO_AGRUPADO_NO_ENCONTRADO`**. **`409` `CONGRESO_YA_CANCELADO`** si todos sus turnos ya estaban cancelados.

### 2.8 `DELETE /api/event-groups/:groupId` — eliminar el grupo completo

Sin body. Borra el `EventGroup` (cascada en base de datos borra todos sus `ServiceSlot` y `SlotAssignment`, sin importar si estaban cancelados o no). **`200`** → `{ "deleted": true }`. **`404` `EVENTO_AGRUPADO_NO_ENCONTRADO`**.

### 2.9 Tabla resumen de códigos de error propios de esta sección

| Código | HTTP | Causa | Cómo resolverlo |
|---|---|---|---|
| `CONGRESO_MINIMO_DOS_FECHAS` | 400 | Al crear el grupo, los turnos enviados cubren menos de 2 fechas distintas | Agregar turnos en al menos 2 fechas distintas antes de crear |
| `EQUIPO_NO_VALIDO` | 400 | `teamIds` vacío, con duplicados, o incluye un equipo que no es `REGULAR` de ese mes | Revisar la lista de equipos regulares del mes (`GET /api/months/:id/teams`) |
| `EVENTO_AGRUPADO_NO_ENCONTRADO` | 404 | `groupId` no corresponde a ningún `EventGroup` (borrado o nunca existió) | Recargar la lista de grupos (`GET /api/months/:id/event-groups`) |
| `TURNO_NO_ENCONTRADO` | 404 | `slotId` no existe, o existe pero no pertenece a ningún grupo | Recargar el grupo; no se puede editar/eliminar así un turno suelto (usar `/api/events/:eventId`) |
| `CONGRESO_YA_CANCELADO` | 409 | Se intentó cancelar un grupo cuyos turnos ya estaban todos cancelados | No repetir la acción; el grupo ya quedó cancelado |
| `HORARIO_NO_GENERADO` | 409 | El mes todavía no tiene horario base (`generate-schedule` no corrió) | Generar el horario del mes antes de crear un Congreso |
| `MES_PASADO` | 409 | El mes es `FINALIZED` y ya pasó (no es el actual ni uno futuro) | No se puede editar; crear/editar solo en el mes actual o uno futuro |

---

## 3. Adelanto del mes siguiente en los últimos 8 días

Endpoints afectados: `GET /api/schedule/:year/:month`, `GET /api/schedule/history` (ambos públicos, sin auth). `GET /api/schedule/latest` **no cambió**.

**Antes:** `isWithinHistoryWindow` (la ventana de 1 año, `docs/architecture/phase5-public-page-contract.md`) solo limita hacia **atrás** — `monthsBetween` da un número negativo para un mes futuro, que siempre es `<= PUBLIC_HISTORY_MONTHS`. Por diseño de esa función (no por un bug puntual), un mes futuro `FINALIZED` pasaba sin ninguna restricción por la consulta manual — inconsistente con la intención original de "la página pública nunca se adelanta a un mes futuro", que hasta esta ronda solo se había aplicado al *default* (`GET /schedule/latest`, sin cambios desde 2026-08-22).

**Ahora**, `server/src/services/publicSchedule.service.js` agrega:

```js
function isNextMonthEarlyRevealed(year, month) {
  const today = currentCivilDate(env.APP_TIMEZONE);
  const nextMonth = today.month === 12 ? { year: today.year + 1, month: 1 } : { year: today.year, month: today.month + 1 };
  if (year !== nextMonth.year || month !== nextMonth.month) return false;

  const totalDaysThisMonth = daysInMonth(today.year, today.month);
  return today.day >= totalDaysThisMonth - 7;
}
```

- Un mes estrictamente futuro (`(year, month)` posterior al mes civil actual) solo se revela por consulta manual si es **exactamente** el mes siguiente al actual **Y** hoy es uno de los últimos 8 días del mes actual (`día >= díasDelMesActual - 7`, es decir el día `díasDelMesActual - 7` cuenta como el primero de esos 8 días).
- Cualquier mes **2 o más meses** en el futuro nunca se revela, sin importar el día (`isNextMonthEarlyRevealed` devuelve `false` de entrada si `(year, month) !== nextMonth`).
- `daysInMonth` (`server/src/utils/dates.js`) se exportó para esta ronda (antes era una función interna, solo usada por `lastWeekdayOf`).

Aplicado en `getPublicScheduleFor(year, month)` y `listPublicScheduleHistory()`:
```js
if (isStrictlyFuture(year, month) && !isNextMonthEarlyRevealed(year, month)) {
  throw new NotFoundError(PUBLIC_NOT_FOUND_MESSAGE, { code: "MES_NO_PUBLICADO" });
}
```

**Ejemplo concreto** (hoy = 2026-08-27, agosto tiene 31 días → últimos 8 días = del 24 al 31 de agosto inclusive):
- `GET /api/schedule/2026/9` (septiembre = mes siguiente): **revelado** (27 >= 31-7=24) si septiembre 2026 ya está `FINALIZED`.
- `GET /api/schedule/2026/10` (octubre = 2 meses en el futuro): **nunca** revelado, sin importar qué día sea hoy, aunque octubre 2026 ya esté `FINALIZED`.
- El mismo `GET /api/schedule/2026/9` el 2026-08-20 (antes de los últimos 8 días): **`404` `MES_NO_PUBLICADO`**, mismo mensaje genérico que "no existe" o "sigue en `DRAFT`" — no se distingue el motivo (mismo principio de privacidad del resto de `docs/architecture/phase5-public-page-contract.md`).

`GET /api/schedule/latest` (`getLatestPublicSchedule`) no llama a `isNextMonthEarlyRevealed` — sigue, sin cambios desde 2026-08-22, sin saltar nunca a un mes futuro como *default*.

---

## 4. Versículo del mes

### 4.0 Concepto y modelo

El administrador puede agregar uno o más pasajes bíblicos (mismo libro y capítulo, uno o más versículos) para mostrar en la página pública del mes. Versión fija **Reina Valera 1960** (`RVR1960`) — se evaluaron APIs bíblicas gratuitas sin key antes de decidir el scraping, pero solo ofrecían Reina Valera 1909, no la 1960 que la mayoría de las congregaciones espera; se procedió con scraping a `biblegateway.com` a pedido explícito del usuario, con el riesgo (fragilidad del HTML, ToS dudoso para acceso automatizado) asumido y documentado.

```prisma
model VersePassage {
  id           String   @id @default(cuid())
  monthCycleId String   @map("month_cycle_id")
  book         String
  chapter      Int
  verses       String   // rango tal como lo escribió el admin, ej. "16-18" o "16,18,20"
  version      String   @default("RVR1960")
  text         String   @db.Text // texto resuelto por bibleSource.service.js, cacheado al agregarlo
  reference    String   // texto de referencia legible, ej. "Juan 3:16-18 (RVR1960)"
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  monthCycle MonthCycle @relation(fields: [monthCycleId], references: [id], onDelete: Cascade)

  @@index([monthCycleId])
  @@map("verse_passage")
}
```

El texto se resuelve **una sola vez**, al agregar el versículo (o al editarlo, si cambia la referencia), vía `server/src/services/bibleSource.service.js` — la página pública **nunca** llama a BibleGateway en el momento de la visita, solo lee lo ya persistido en `VersePassage`. Un mes puede tener uno o más `VersePassage`, ordenados por `createdAt`.

Editable mientras el mes es `DRAFT` o `FINALIZED` actual/futuro (`assertEditableConsideringFinalization`, **`409` `MES_PASADO`** si ya pasó — mismo criterio que el resto de la app).

Auth de las 4 rutas: `requireAuth` + `adminLimiter`, aplicados por ruta (router montado en `/`, mezcla `/months/:id/verses` con `/verses/:id`, mismo patrón que `eventGroups.routes.js`).

### 4.1 `GET /api/months/:id/verses` — listar los versículos del mes

Sin body. **`200`** → `{ "verses": [ { "id", "book", "chapter", "verses", "version", "text", "reference" }, ... ] }`, orden `createdAt asc`. **`404` `Mes no encontrado.`** si el `id` no existe.

### 4.2 `POST /api/months/:id/verses` — agregar un versículo

Body:
```json
{ "book": "Juan", "chapter": 3, "verses": "16-18" }
```

| Campo | Reglas |
|---|---|
| `book` | string, `1..50` |
| `chapter` | entero `>= 1` (coaccionado desde string si hace falta, `z.coerce.number()`) |
| `verses` | string, formato `"16"`, `"16-18"` o `"16,18,20"` (regex `/^\d{1,3}(-\d{1,3})?(,\d{1,3}(-\d{1,3})?)*$/`) |

El service llama `fetchVerseText({ book, chapter, verses })` (`bibleSource.service.js`) **fuera** de cualquier transacción de Prisma (a propósito: una transacción no debe esperar a una fuente externa lenta o caída, eso mantendría una conexión de la base ocupada sin necesidad).

**`201`** →
```json
{
  "verse": {
    "id": "vp_1",
    "book": "Juan",
    "chapter": 3,
    "verses": "16-18",
    "version": "RVR1960",
    "text": "Porque de tal manera amó Dios al mundo, que ha dado a su Hijo unigénito, para que todo aquel que en él cree, no se pierda, mas tenga vida eterna. Porque no envió Dios a su Hijo al mundo para condenar al mundo, sino para que el mundo sea salvo por él. El que en él cree, no es condenado; pero el que no cree, ya ha sido condenado, porque no ha creído en el nombre del unigénito Hijo de Dios.",
    "reference": "Juan 3:16-18 (RVR1960)"
  }
}
```
(Texto idéntico al fragmento HTML real de Juan 3:16-18 RVR1960 capturado a mano el 2026-08-25 y fijado como test de regresión en `server/tests/bibleSource.test.js`, verificado acá contra ese archivo.)

Errores propios de `fetchVerseText` (ver §4.5): **`404` `VERSICULO_NO_ENCONTRADO`**, **`503` `FUENTE_BIBLICA_NO_DISPONIBLE`**. Más **`404` `Mes no encontrado.`** y **`409` `MES_PASADO`** (comunes al resto de esta sección).

### 4.3 `PATCH /api/verses/:verseId` — editar un versículo

Body parcial (`book?`, `chapter?`, `verses?`, al menos uno). Si viene cualquiera de los tres, se considera que la referencia cambió y se vuelve a llamar `fetchVerseText` con los valores fusionados (los que vienen en el body, o si no los que ya tenía el `VersePassage`) — vuelve a resolver `text`/`reference` desde cero. Si el body no toca ninguno de esos tres campos (no debería poder pasar, dado que el schema no tiene ningún otro campo editable), no se re-scrapea.

**`200`** → `{ "verse": { ...mismo shape que 4.2... } }`. **`404` `VERSICULO_NO_ENCONTRADO`** si `verseId` no existe (mismo código que usa `bibleSource.service.js` para "referencia inválida" — contextos distintos, mismo código, distinguibles por el endpoint que se llamó). **`409` `MES_PASADO`**.

### 4.4 `DELETE /api/verses/:verseId` — eliminar un versículo

Sin body. **`200`** → `{ "deleted": true }`. **`404` `VERSICULO_NO_ENCONTRADO`** si `verseId` no existe. **`409` `MES_PASADO`**.

### 4.5 `bibleSource.service.js` — adaptador de scraping a BibleGateway

Aislado a propósito en su propio archivo (no importado por nada más que `verses.service.js`): si BibleGateway deja de funcionar o cambia su HTML, alcanza con reescribir este módulo (misma firma `fetchVerseText({ book, chapter, verses })`) sin tocar `verses.service.js` ni el resto del sistema.

- URL: `https://www.biblegateway.com/passage/?search=<book> <chapter>:<verses> URL-encoded&version=RVR1960`.
- User-Agent explícito (`Mozilla/5.0 (compatible; OrganizacionEquiposServiceBot/1.0)`) — BibleGateway devuelve contenido distinto o vacío a clientes sin cabecera de navegador reconocible.
- Parseo con `cheerio` (única dependencia nueva de esta ronda): recorre **todos** los bloques `.passage-text .text-html` de la página (uno por cada versículo/rango separado por coma, no todos vienen en el mismo bloque), quita `<sup class="versenum">`/`<sup class="crossreference">`/`<span class="chapternum">`/títulos de sección (`<h3>`/`<h4>`)/`<div class="crossrefs">`/`<a class="full-chap-link">`, y concatena el texto restante.
- **`404` `VERSICULO_NO_ENCONTRADO`** — la referencia no existe (ej. "Juan 99:99"): BibleGateway responde `200 OK` pero sin ningún bloque `.passage-text` en el HTML (ni siquiera intenta renderizar el pasaje) — "200 pero cero bloques" se interpreta como referencia inválida, no como falla de la fuente.
- **`503` `FUENTE_BIBLICA_NO_DISPONIBLE`** — falla de red (timeout, DNS, etc.), la respuesta HTTP no es `2xx`, o el parser lanza una excepción inesperada (BibleGateway cambió su estructura HTML de forma más profunda que lo esperado).
- **Bug real encontrado y corregido por QA (2026-08-27)**: en pasajes de poesía (Salmos, Proverbios, etc.), cada verso viene envuelto en su propio `<p class="verse line">`, y entre `</p><p class="verse line">` consecutivos a veces no hay ningún espacio en el HTML fuente (a diferencia de los pasajes en prosa, donde siempre hay espacio entre bloques) — llamar `.text()` sobre todo el bloque de una sola vez pegaba palabras consecutivas sin espacio (ej. "descansar;Junto" en vez de "descansar; Junto"). Corregido uniendo el texto de cada `<p>` por separado con un espacio explícito entre ellos, en vez de leer el bloque completo de un tirón. Test de regresión: `server/tests/bibleSource.test.js`, con HTML real de Salmos 23 capturado en vivo.

### 4.6 Payload público (`GET /api/schedule/latest`, `/history`, `/:year/:month`)

`buildPublicPayload` (`publicSchedule.service.js`) suma `verses` al payload cacheado por mes:

```json
{
  "month": { "year": 2026, "month": 8, "finalizedAt": "2026-08-08T20:00:00.000Z" },
  "teams": [ "..." ],
  "slots": [ "..." ],
  "verses": [
    { "id": "vp_1", "reference": "Juan 3:16-18 (RVR1960)", "text": "Porque de tal manera amó Dios al mundo...", "version": "RVR1960" }
  ]
}
```
`verses: []` si el mes no tiene ningún `VersePassage` agregado — nunca se omite el campo. El shape público es un subconjunto del shape administrativo (`GET /api/months/:id/verses`): no expone `book`/`chapter`/`verses` (el rango crudo), solo `reference` ya formateada + `text` + `version`.

### 4.7 Tabla resumen de códigos de error propios de esta sección

| Código | HTTP | Causa | Cómo resolverlo |
|---|---|---|---|
| `VERSICULO_NO_ENCONTRADO` | 404 | Al agregar/editar: la referencia bíblica no existe según BibleGateway. Al editar/eliminar: `verseId` no corresponde a ningún `VersePassage` | Revisar libro/capítulo/versículo, o recargar la lista de versículos del mes |
| `FUENTE_BIBLICA_NO_DISPONIBLE` | 503 | Falla de red hacia BibleGateway, respuesta no-2xx, o el HTML no tiene la estructura esperada | Reintentar más tarde; si persiste, puede que BibleGateway haya cambiado su markup (revisar `bibleSource.service.js`) |
| `MES_PASADO` | 409 | El mes es `FINALIZED` y ya pasó | No se puede agregar/editar/eliminar; solo en el mes actual o uno futuro |

---

## 5. Migración de esquema

`server/prisma/migrations/20260825010000_free_teams_needed_event_groups_verses/migration.sql` (escrita a mano, no generada con `prisma migrate dev` — entorno no interactivo de la sesión, mismo criterio que las migraciones anteriores del proyecto; el nombre de la carpeta continúa la numeración de la migración inmediatamente anterior, `20260825000000_youth_service_cancellable`, aunque se aplicó en esta ronda del 2026-08-27):

1. `service_slot_teams_needed_range` (`teams_needed BETWEEN 1 AND 2`) → `service_slot_teams_needed_positive` (`teams_needed >= 1`, sin tope superior — el tope real, dinámico por mes, lo valida la app en `events.service.js`/`eventGroups.service.js`, no se puede expresar como una constante en un `CHECK`).
2. `slot_assignment_slot_index_range` (tope duro de 2 equipos por turno) → `slot_assignment_slot_index_positive` (`slot_index >= 0`, sin tope superior — un turno de Congreso puede llevar más de 2 equipos elegidos a mano; que un `slotIndex` no se repita para el mismo turno lo sigue garantizando el `@@unique([serviceSlotId, slotIndex])`, sin cambios).
3. Crea `event_group` (`id`, `month_cycle_id` con FK cascada a `month_cycle`, `title`, timestamps) + índice por `month_cycle_id`.
4. Agrega `service_slot.event_group_id` (nullable) + FK cascada a `event_group` + índice.
5. Crea `verse_passage` (`id`, `month_cycle_id` con FK cascada a `month_cycle`, `book`, `chapter`, `verses`, `version` default `'RVR1960'`, `text`, `reference`, timestamps) + índice por `month_cycle_id`.

### Hallazgo menor abierto — sin tope superior de sanidad a nivel de base (no bloqueante)

Al relajar los `CHECK` de los puntos 1 y 2, ya no queda ningún tope superior a nivel de base de datos para `teams_needed`/`slot_index`. La API nunca deja pasar un valor absurdo (se valida contra el conteo real de equipos `REGULAR` del mes en cada escritura, tanto en `events.service.js` como en `eventGroups.service.js`), pero una manipulación directa de la base (fuera de la API, ej. acceso directo a `psql`) hoy podría insertar un valor sin sentido que el `CHECK` original habría impedido. Superficie de ataque acotada a "acceso directo a Postgres" — no urgente, documentado acá para que quede registrado si en algún momento se quiere agregar un tope de sanidad razonable (ej. `<= 50`) puramente defensivo.
