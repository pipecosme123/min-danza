# Fase 4 — Contrato cerrado de horario, balance, eventos y uniformes

**Estado:** cerrado para implementar. Referencia obligatoria para `backend-developer` y `frontend-developer`.
**Fecha:** 2026-08-08
**Alcance:** `POST /api/months/:id/generate-schedule`, `GET /api/months/:id/schedule`, `POST /api/months/:id/events`, `DELETE /api/events/:eventId`, `PATCH /api/assignments/:id`, `GET/POST /api/uniforms`, `PATCH /api/uniforms/:id`, `GET/PUT /api/uniforms/weekday-config`, `GET/PUT /api/uniforms/youth-service-config`. También ajustes a `generateTeams` (Fase 3) por la interacción con el horario. La página pública (`GET /api/schedule/:year/:month`, hoy 501) sigue **fuera de alcance**: es Fase 5.

Fuentes: `CLAUDE.md`, `docs/architecture/phase1-schema-design.md` (§5 "Contrato de `recomputeBalance`" y D7-D12 — el esquema ya está diseñado alrededor de esto, no hay que rediseñar tablas), `docs/architecture/phase3-teams-contract.md` §9 (equipo de jóvenes), stubs reales en `server/src/routes/{events,assignments,uniforms,schedule,specialSaturday}.routes.js`, utilidades ya construidas en `server/src/utils/dates.js` (última fecha de un día de semana, fechas civiles) y `client/src/components/domain/{SlotCard,CalendarGrid}.jsx` (ya existen, listos para reusar).

---

## 0. Cambio de rumbo respecto al plan original: "Sábado especial" → "Servicio de jóvenes"

El plan original (`docs/architecture/phase1-schema-design.md`) diseñó `ServiceSlot.slotType = SPECIAL` como el evento del último sábado con **roster manual** (`SpecialSaturdayMember`) que **no** contaba en el balance. Esa regla de negocio cambió (ver `CLAUDE.md` §"Servicio de jóvenes", actualizado 2026-08-08): ahora el "equipo de jóvenes" se sortea junto con los equipos regulares en `generate-teams` (Fase 3, ya implementado) y **sí** cuenta como evento obligatorio. Esta fase conecta esa pieza ya construida con el horario:

- `SlotType.SPECIAL` se **renombra** a `SlotType.YOUTH_SERVICE` (el valor `SPECIAL` deja de existir; no queda como alias). Título fijo: "Servicio de jóvenes". Fecha: último sábado del mes. Hora: `18:50`. `teamsNeeded: 1`. `countsTowardBalance: true` **siempre** (nunca `false`).
- El equipo asignado a este slot **no se elige a mano por evento**: es directamente el `Team` con `teamType: YOUTH` del `MonthCycle` (si existe ese mes — el admin pudo deshabilitar el equipo de jóvenes al generar equipos, ver Fase 3 §9). Si no existe equipo `YOUTH` ese mes, este slot **no se genera**.
- `SpecialSaturdayMember` **se elimina** del esquema (tabla, relaciones desde `Person` y `ServiceSlot`, y el router `specialSaturday.routes.js` completo). No tiene ningún otro propósito en el sistema — era exclusivamente el roster manual de este evento, que ahora ya no existe como concepto.
- La pantalla `SpecialSaturdayManager.jsx`, su ruta `/admin/sabado-especial` y su entrada de navegación "Sábado especial" **se eliminan** del frontend. No queda ningún rastro de "Sábado especial" en la interfaz.
- El CHECK `service_slot_special_never_counts` (`slot_type <> 'SPECIAL' OR counts_toward_balance = false`, en `20260807223909_init/migration.sql`) se **elimina** — ya no aplica, `YOUTH_SERVICE` siempre cuenta.

Todo lo demás del diseño original de `ServiceSlot`/`SlotAssignment`/`recomputeBalance` (D7-D13 de `phase1-schema-design.md`) sigue vigente tal cual — esta fase lo implementa, no lo rediseña.

---

## 1. Cambios de esquema (`server/prisma/schema.prisma`)

1. **Enum `SlotType`**: `SPECIAL` → `YOUTH_SERVICE` (`ALTER TYPE "slot_type" RENAME VALUE 'SPECIAL' TO 'YOUTH_SERVICE';` en SQL crudo — Prisma no tiene sintaxis declarativa para renombrar un valor de enum, hay que editarlo a mano en la migración generada, mismo estilo que ya se hizo para el índice único parcial de Fase 3). Actualizar el comentario del enum en el schema (ya no dice "roster manual", dice "Servicio de jóvenes, ver Fase 4").
2. **Eliminar `SpecialSaturdayMember`** por completo: el modelo, la relación `Person.specialEventRoles`, la relación `ServiceSlot.specialMembers`.
3. **Eliminar el CHECK** `service_slot_special_never_counts` (SQL crudo: `ALTER TABLE "service_slot" DROP CONSTRAINT "service_slot_special_never_counts";`). El campo `countsTowardBalance` queda en el schema (se preserva la flexibilidad para el futuro que ya documentó D-alguno del diseño original), pero sin ningún CHECK atado a `slotType`; en la práctica todo slot que se genera en esta fase (`FIXED`, `EXTRAORDINARY`, `YOUTH_SERVICE`) nace con `countsTowardBalance: true` — no hay ningún camino en esta fase que produzca `false`.
4. **Nuevo modelo `YouthServiceUniform`** (config global, una sola fila, mismo espíritu que `WeekdayUniform` pero sin dimensión de día porque este evento no varía por día de semana — siempre es el último sábado):
   ```prisma
   /// Config del uniforme del "Servicio de jóvenes" (último sábado del mes).
   /// Es un singleton deliberado: como máximo una fila. El service la
   /// lee/escribe con findFirst/upsert sobre esa única fila, nunca por id
   /// conocido de antemano (no hay UI de "crear una nueva fila").
   model YouthServiceUniform {
     id        String   @id @default(cuid())
     uniformId String   @map("uniform_id")
     updatedAt DateTime @updatedAt @map("updated_at")

     uniform Uniform @relation(fields: [uniformId], references: [id], onDelete: Restrict)

     @@map("youth_service_uniform")
   }
   ```
   Agregar la relación inversa `youthServiceUniforms YouthServiceUniform[]` en `Uniform`.

Correr `npx prisma migrate dev --name phase4_schedule_youth_service`, editar el SQL generado para el rename de enum value + el DROP CONSTRAINT (Prisma no los genera solo), regenerar el cliente.

---

## 2. `POST /api/months/:id/generate-schedule`

Genera el horario completo del mes: turnos fijos (miércoles/domingo) + el slot de "Servicio de jóvenes" si corresponde, y hace la primera asignación de equipos (balance inicial). Es la pieza que faltaba entre "ya hay equipos" (Fase 3) y "hay horario con equipos asignados".

Body (opcional): `{ "regenerate": false }`.

### Precondiciones

- **404** si el mes no existe.
- **409** `MES_FINALIZADO` si `status !== "DRAFT"`.
- **409** `EQUIPOS_NO_GENERADOS` si el mes no tiene ningún `Team` con `teamType: REGULAR` todavía (no tiene sentido armar horario sin equipos para repartir) → `details: {}`.
- Si el mes **ya tiene** `ServiceSlot` generados:
  - `regenerate` ausente o `false` → **200**, devuelve el horario existente tal cual está (llamada idempotente, no destructiva — así una doble-carga del formulario del admin no rompe nada).
  - `regenerate: true` → borra TODOS los `ServiceSlot` del mes (cascada borra sus `SlotAssignment`; los `EXTRAORDINARY` que el admin haya creado a mano **también se pierden**, es intencional y debe advertirse en el frontend con una confirmación, mismo patrón que el re-sorteo de equipos) y regenera desde cero.

### Algoritmo (`scheduleGeneration.service.js`)

1. `weekdaysIn(year, month, 3)` (miércoles) → por cada fecha, crear 2 `ServiceSlot` `FIXED`: `17:00` y `19:00`, `teamsNeeded: 1`. (Nota: la mención original de `WeekdayUniform` acá está obsoleta — Fase 4b eliminó ese modelo por completo; todo `ServiceSlot` nace con `uniformId: null` siempre, sin ningún default automático, ver `phase4b-schedule-refinements-contract.md` §1.2).
2. `weekdaysIn(year, month, 0)` (domingo) → por cada fecha **que no sea** `lastSundayOf(year, month)`: 2 `ServiceSlot` `FIXED` (`08:00`, `10:30`), `teamsNeeded: 1`. Para el **último domingo**: un solo `ServiceSlot` `FIXED` a las `08:00`, `teamsNeeded: 2`, `title: "Ayuno Congregacional"` (nombre fijo agregado 2026-08-22).
3. `firstFridayOf(year, month)` (agregado 2026-08-22): un `ServiceSlot` `FIXED` en esa fecha, `19:00`, `teamsNeeded: 2`, `title: "Vigilia Unida - Comuna 21"` — mismo mecanismo que la excepción del último domingo (un solo slot con `teamsNeeded: 2`, sin turno "hermano" ese día), pero incondicional (se genera todos los meses, no depende de si hay equipo `YOUTH`).
4. Si el mes tiene un `Team` con `teamType: YOUTH`: un `ServiceSlot` `YOUTH_SERVICE` en `lastSaturdayOf(year, month)`, `18:50`, `title: "Servicio de jóvenes"`, `teamsNeeded: 1`, `countsTowardBalance: true`, `uniformId: null`.
5. Persistir todos los `ServiceSlot` en una transacción.
6. Ejecutar `recomputeBalance(monthCycleId)` (ver §3) dentro de la MISMA transacción para dejar el mes con equipos ya asignados, no solo los slots vacíos.
7. Sin warnings de uniforme: como ningún slot intenta un default automático (Fase 4b), no hay nada que advertir en este paso — los `UNIFORME_*_NO_CONFIGURADO` mencionados en una versión anterior de este contrato ya no existen.

**200 →**
```json
{
  "slots": [
    { "id": "clx…", "date": "2026-08-05", "startTime": "17:00", "slotType": "FIXED", "title": null,
      "teamsNeeded": 1, "countsTowardBalance": true, "uniform": { "id": "clxU1", "name": "Uniforme A", "colorHex": "#1E40AF" },
      "teams": [ { "id": "clxT1", "label": "Equipo 1" } ] },
    { "id": "clx…YS", "date": "2026-08-29", "startTime": "18:50", "slotType": "YOUTH_SERVICE", "title": "Servicio de jóvenes",
      "teamsNeeded": 1, "countsTowardBalance": true, "uniform": null,
      "teams": [ { "id": "clxTY", "label": "Servicio de jóvenes" } ] }
  ],
  "warnings": []
}
```
Orden: `date ASC, startTime ASC`. `teams` siempre presente (`[]` si por lo que sea no se pudo asignar, no debería pasar salvo el caso límite de 0 equipos regulares que ya está cubierto por `EQUIPOS_NO_GENERADOS`).

## 3. `recomputeBalance(monthCycleId)` — función interna, no un endpoint

Implementa **exactamente** el contrato ya fijado en `docs/architecture/phase1-schema-design.md` §5, sin reinventarlo:

1. Corre dentro de una transacción (la propia, o la del caller si ya hay una abierta — `generate-schedule`, `events` y esta función deben poder componerse).
2. Borra las `SlotAssignment` del mes con `locked = false`. Nunca toca las `locked = true`.
3. Recorre los `ServiceSlot` del mes con `countsTowardBalance = true`, orden `(date ASC, startTime ASC)`.
4. Para cada slot: **si `slotType === "YOUTH_SERVICE"`**, la asignación es directa y fija — el único equipo `teamType: YOUTH` del mes, `slotIndex: 0`, sin pasar por el cálculo de menor conteo (no hay "balance" entre un solo equipo posible). **Para `FIXED`/`EXTRAORDINARY`**: calcula cuántos equipos faltan (`teamsNeeded − asignaciones locked existentes`), elige entre los `Team` `teamType: REGULAR` del mes los de menor conteo acumulado (contando también las `locked`, que ya ocupan cupo), desempate aleatorio, sin repetir equipo dentro del mismo slot, y asigna con el menor `slotIndex` libre (0, luego 1).
5. El conteo de participaciones de un equipo = `COUNT(slot_assignment)` filtrado por `serviceSlot.countsTowardBalance = true` — no hay contador denormalizado (mismo criterio ya documentado, evita desincronización).

Esta función se reusa en tres lugares: al final de `generate-schedule` (balance inicial), al crear/borrar un evento `EXTRAORDINARY` (§4), y nunca se dispara sola desde ningún endpoint público.

## 4. `POST /api/months/:id/events` — eventos extraordinarios

Body: `{ "date": "2026-08-15", "startTime": "19:30", "title": "Vigilia", "teamsNeeded": 1, "uniformId": "clxU1" }`

| Campo | Reglas |
|---|---|
| `date` | fecha civil dentro del mes del `MonthCycle` (año/mes deben coincidir) → si no, **400** `FECHA_FUERA_DE_MES` |
| `startTime` | `"HH:mm"` 24h |
| `title` | string, `1..100` |
| `teamsNeeded` | **Ampliado 2026-08-27** (antes fijo a `1` o `2`): admite `1..cantidad de equipos REGULAR del mes` — el tope se valida en el service contra el conteo real (`tx.team.count`), no en el schema Zod (el máximo es dinámico por mes, no una constante). `400 TEAMSNEEDED_EXCEDE_EQUIPOS` si se excede. Requirió relajar el `CHECK` de base `service_slot_teams_needed_range`→`service_slot_teams_needed_positive` (`>= 1`, sin tope superior). Ver `docs/architecture/phase8-congreso-and-verses-contract.md` §1 para el detalle completo y el resto de la ronda que trajo este cambio. |
| `uniformId` | opcional, debe existir y estar `active: true` si viene |

- **404** si el mes no existe.
- **409** `MES_FINALIZADO` si no está `DRAFT`.
- **409** `HORARIO_NO_GENERADO` si el mes todavía no tiene `ServiceSlot` (`generate-schedule` no se corrió) → hay que generar el horario base antes de agregar eventos sueltos, evita un mes con un evento extraordinario huérfano y ningún turno fijo.
- Crea el `ServiceSlot` (`slotType: EXTRAORDINARY`, `countsTowardBalance: true`), corre `recomputeBalance` en la misma transacción, devuelve el slot creado con sus equipos asignados: `{ "slot": { …mismo shape que arriba… } }`.
- Sugerencia de UI (no server-side): el frontend puede precargar `uniformId` con el `WeekdayUniform` del día de la semana de `date` como default editable — el admin lo cambia si quiere, no es obligatorio que coincida.

## 5. `DELETE /api/events/:eventId`

- **404** `EVENTO_NO_ENCONTRADO` si no existe o si el slot **no** es `EXTRAORDINARY` (no se puede borrar un `FIXED` ni el `YOUTH_SERVICE` por acá — esos solo se regeneran vía `generate-schedule` con `regenerate: true`).
- **409** `MES_FINALIZADO` si el mes no está `DRAFT`.
- Borra el `ServiceSlot` (cascada borra su `SlotAssignment`), corre `recomputeBalance`, **200** `{ "deleted": true }`.

## 6. `PATCH /api/assignments/:id`

Body: `{ "locked"?: boolean, "teamId"?: string }` (al menos uno de los dos).

- **404** `ASIGNACION_NO_ENCONTRADA`.
- **409** `MES_FINALIZADO` si el mes del slot no está `DRAFT`.
- **400** `ASIGNACION_JOVENES_NO_EDITABLE` si se intenta cambiar `teamId` en una asignación cuyo slot es `YOUTH_SERVICE` (ese slot siempre es del equipo `YOUTH`, no es reasignable a mano; `locked` sí se puede tocar aunque no tenga efecto práctico, por consistencia de la API).
- Si viene `teamId`: debe ser un `Team` `teamType: REGULAR` del mismo mes → si no, **400** `EQUIPO_NO_VALIDO`. Reasignar a mano **implica** `locked: true` automáticamente (una reasignación manual que `recomputeBalance` pudiera deshacer en la próxima corrida no tendría sentido) — si el body no manda `locked` explícito, se fuerza `true` de todos modos cuando se cambia `teamId`.
- Si viene solo `locked` (sin `teamId`): cambia el flag tal cual.
- **200** → `{ "assignment": { "id", "serviceSlotId", "teamId", "slotIndex", "locked" } }`.

## 7. Uniformes (`server/src/routes/uniforms.routes.js`, reemplaza los 501)

- `GET /api/uniforms` → `{ "data": [ { "id", "name", "colorHex", "description", "active" } ] }`, todos (activos e inactivos, es una lista de configuración chica, no necesita paginación).
- `POST /api/uniforms` → body `{ "name", "colorHex"?, "description"? }`, **201** el uniforme creado. `name` único → **409** `UNIFORME_DUPLICADO` si ya existe.
- `PATCH /api/uniforms/:id` → body parcial `{ "name"?, "colorHex"?, "description"?, "active"? }` (el frontend ya tiene `updateUniform(id, data)` esperando esto — hoy no existe la ruta en el stub, hay que agregarla, no solo implementar las que ya estaban). **200** el uniforme actualizado.
- `GET /api/uniforms/weekday-config` → `{ "data": [ { "weekday": "WEDNESDAY", "uniformId": "clx…" }, { "weekday": "SUNDAY", "uniformId": "clx…" } ] }` (puede faltar alguno de los dos si no está configurado).
- `PUT /api/uniforms/weekday-config/:weekday` → body `{ "uniformId": "clx…" }`, upsert de esa fila. `:weekday` = `WEDNESDAY` | `SUNDAY` (los otros 5 valores del enum `Weekday` son válidos en el schema pero no se usan hoy — devolver **400** si no es uno de esos dos, evita configurar un día que ningún slot fijo va a usar nunca). El frontend ya llama exactamente a esta forma (`updateWeekdayUniform(weekday, uniformId)` → `PATCH .../weekday-config/${weekday}`, revisar `client/src/api/uniforms.js`) salvo que ahí dice `apiClient.patch`, no `.put` — usar `PATCH`, no `PUT`, para no tener que tocar el frontend ya escrito (el nombre "PUT" de arriba es conceptual/upsert, el verbo HTTP real es `PATCH`).
- `GET /api/uniforms/youth-service-config` → `{ "uniformId": "clx…" } ` o `{ "uniformId": null }` si no está configurado.
- `PATCH /api/uniforms/youth-service-config` → body `{ "uniformId": "clx…" }`, upsert de la única fila de `YouthServiceUniform`.
- D9 ya confirmado en Fase 1: cambiar cualquiera de estas configs **no reescribe** los `ServiceSlot` ya generados de meses en curso — solo aplica a la próxima vez que se corra `generate-schedule`.

## 8. `GET /api/months/:id/schedule`

Lectura del horario completo del mes con el balance de participaciones — endpoint admin (no confundir con `GET /api/schedule/:year/:month`, que es el público de Fase 5 y sigue sin implementar).

- **404** si el mes no existe.
- **200** → 
  ```json
  {
    "slots": [ /* mismo shape que la respuesta de generate-schedule */ ],
    "balance": [ { "teamId": "clxT1", "label": "Equipo 1", "count": 6 }, … ]
  }
  ```
  `balance` incluye SOLO equipos `teamType: REGULAR` (el `YOUTH` no compite por balance, tiene siempre 0 o 1 según si se generó su slot — no aporta información útil a esta vista). `slots: []` y `balance: []` si todavía no se generó el horario (no es error).

---

## 9. Interacción con `generate-teams` (Fase 3) — ajuste necesario

Confirmado con el usuario: re-sortear equipos mientras el mes está `DRAFT` sigue permitido tal cual hoy, pero si el mes ya tenía horario generado, ese horario se pierde.

Cambio en `teamGeneration.service.js`: dentro de la misma transacción que borra/recrea los `Team`, si `serviceSlot.count({ where: { monthCycleId } }) > 0`, borrar también esos `ServiceSlot` (cascada ya se encarga de `SlotAssignment`; se borran explícitamente para no dejar slots huérfanos sin ninguna asignación). Agregar un warning a la respuesta de `generate-teams` cuando esto pasó: `HORARIO_BORRADO_POR_RESORTEO` — `"Se borró el horario del mes porque los equipos cambiaron. Volvé a generarlo desde la sección de Eventos."`.

---

## 10. Frontend

- `client/src/api/schedule.js` (nuevo): `generateSchedule(monthId, data)`, `getMonthSchedule(monthId)`, `createEvent(monthId, data)`, `deleteEvent(eventId)`, `updateAssignment(id, data)`.
- `client/src/api/uniforms.js` (ya existe, ajustar si hace falta al verbo/forma real que termine implementando el backend — ver nota de §7 sobre `PATCH` vs `PUT`) + agregar `getYouthServiceUniform()`/`updateYouthServiceUniform(uniformId)`.
- **`EventsManager.jsx`** deja de ser placeholder: se convierte en la pantalla de "Horario y eventos" del mes elegido (reusa el selector de mes que ya existe en `TeamGenerator.jsx` — no dupliques ese patrón, factorizalo si hace falta o replicalo igual de simple). Contenido:
  - Si el mes no tiene horario: botón "Generar horario" (deshabilitado con mensaje claro si `EQUIPOS_NO_GENERADOS`).
  - Si ya tiene: `CalendarGrid` + `SlotCard` (ya existen, reusar tal cual) agrupado por semana o por día, mostrando cada turno con su/s equipo/s y uniforme. Botón "Regenerar horario" con `ConfirmDialog` (acción destructiva, mismo patrón que re-sortear equipos) que llama con `regenerate: true`.
  - Resumen de balance (tabla simple `equipo → participaciones`, de `GET .../schedule`).
  - Formulario para crear evento extraordinario (fecha dentro del mes, hora, título, 1 o 2 equipos, uniforme con sugerencia precargada del `WeekdayUniform` del día).
  - Por cada `SlotAssignment` visible: acción de bloquear/desbloquear (`locked`) y reasignar equipo manualmente (select de equipos `REGULAR` del mes) — deshabilitado para el slot `YOUTH_SERVICE`.
  - Eliminar evento extraordinario (no ofrecer esta acción para `FIXED`/`YOUTH_SERVICE`, `SlotCard` ya expone `slot.slotType` para decidir esto).
- **`SlotCard.jsx`**: `SLOT_TYPE_LABELS.SPECIAL` → `SLOT_TYPE_LABELS.YOUTH_SERVICE = 'Servicio de jóvenes'` (quitar la entrada vieja `SPECIAL`).
- **`UniformsManager.jsx`** deja de ser placeholder: alta/edición de uniformes (`GET/POST/PATCH /api/uniforms`), configuración de `WeekdayUniform` (miércoles/domingo) y del nuevo `YouthServiceUniform` ("Uniforme del Servicio de jóvenes").
- **Eliminar por completo**: `client/src/pages/SpecialSaturdayManager.jsx`, su ruta `sabado-especial` en `client/src/App.jsx`, y su entrada `{ to: '/admin/sabado-especial', label: 'Sábado especial' }` en `client/src/components/Layout/NavTabs.jsx`. No debe quedar ningún texto "Sábado especial" visible en la interfaz.

## 11. Fuera de alcance en esta fase (a propósito)

- `GET /api/schedule/:year/:month` (página pública) — Fase 5. Solo debe mostrar meses `FINALIZED`, que todavía no se pueden crear (ver punto siguiente).
- Endpoint para pasar un `MonthCycle` de `DRAFT` a `FINALIZED` — no está en ninguna fase del plan todavía de forma explícita; se resuelve cuando haga falta (probablemente junto a Fase 5, ya que el público solo ve meses `FINALIZED`). Por ahora todo mes queda `DRAFT` indefinidamente, igual que hoy.
- Reporte de asistencia, excusas, inasistencias — fuera de alcance del proyecto completo por ahora (ver `CLAUDE.md`).
