# Fase 4c — Edición limitada de eventos tras publicar el mes

**Estado:** cerrado para implementar. Referencia obligatoria para `backend-developer` y `frontend-developer`.
**Fecha:** 2026-08-08
**Última ampliación:** 2026-08-25 — ver §10 y §11 más abajo. Todo el cuerpo original del documento (§0-§9) se corrigió in situ para reflejar el estado actual; no quedan párrafos con el comportamiento viejo conviviendo con el nuevo.
**Alcance:** ajuste sobre lo ya construido en Fase 4/4b/5. No es una fase nueva del plan, es un refinamiento pedido por el usuario tras usar la Fase 5 (finalizar mes + página pública) en el navegador.

Decisiones ya confirmadas con el usuario (no hace falta volver a preguntar):
1. "Cancelar" un evento extraordinario es **distinto** de eliminarlo: el evento queda registrado y visible (marcado como cancelado), no desaparece sin dejar rastro.
2. Al agregar/cancelar/eliminar un evento en un mes **ya publicado**, el resto de las asignaciones ya publicadas queda **protegido** — el recálculo de balance solo decide el equipo del turno nuevo/afectado, nunca reordena lo que ya estaba.

---

## 0. Regla de negocio nueva

Hoy, `MonthCycle.status = FINALIZED` bloquea **toda** escritura sobre el mes (`MES_FINALIZADO` en todos lados). Esto se relaja para varias acciones puntuales, solo si el mes finalizado es el **actual o uno posterior** (nunca uno que ya pasó). Tabla actualizada al 2026-08-25 (ver §10/§11 para el detalle de qué se amplió en esa fecha respecto de la versión original de este documento, 2026-08-08):

| Acción | Mes `DRAFT` | Mes `FINALIZED`, actual o futuro | Mes `FINALIZED`, ya pasado |
|---|---|---|---|
| Generar/regenerar horario | ✅ | ❌ `MES_FINALIZADO` | ❌ `MES_FINALIZADO` |
| Re-sortear equipos | ✅ | ❌ `MES_FINALIZADO` | ❌ `MES_FINALIZADO` |
| Bloquear/desbloquear una asignación (`PATCH /api/assignments/:id`) | ✅ | ✅ (ampliado 2026-08-25, antes ❌) | ❌ `MES_PASADO` |
| Reasignar equipo a mano (`PATCH /api/assignments/:id`) | ✅ | ✅ (ampliado 2026-08-25, antes ❌) | ❌ `MES_PASADO` |
| Editar evento completo — fecha/hora/título/cantidad de equipos (`PATCH /api/events/:eventId`) | ✅ | ✅ (ampliado 2026-08-25, antes ❌) | ❌ `MES_PASADO` |
| Editar la composición de un equipo — mover personas, cambiar roles (`PATCH /api/teams/:teamId`) | ✅ | ✅ (ampliado 2026-08-25, antes ❌) | ❌ `MES_PASADO` |
| **Agregar** evento extraordinario | ✅ | ✅ | ❌ `MES_PASADO` |
| **Cancelar** evento extraordinario | ✅ | ✅ | ❌ `MES_PASADO` |
| **Eliminar** evento extraordinario | ✅ | ✅ | ❌ `MES_PASADO` |
| **Cambiar el uniforme de UN turno puntual** (`PATCH /api/slots/:id`) | ✅ | ✅ | ❌ `MES_PASADO` |
| **Cancelar** el Servicio de jóvenes (`POST /api/months/:id/youth-team/cancel`, nuevo 2026-08-25) | ✅ | ✅ | ❌ `MES_PASADO` |
| **Eliminar** el equipo de jóvenes (`DELETE /api/months/:id/youth-team`, nuevo 2026-08-25) | ✅ | ✅ | ❌ `MES_PASADO` |
| Eliminar el mes entero (`DELETE /api/months/:id`, agregado 2026-08-22) | ✅ | ✅ (sin cambios en esta ronda) | ❌ `MES_PASADO` |

"Mes actual o posterior" = `(monthCycle.year, monthCycle.month) >= (añoActual, mesActual)`, comparado contra la fecha civil de HOY en `APP_TIMEZONE` (no la hora del proceso del servidor — mismo criterio ya establecido en `server/src/utils/dates.js`, que hoy evita zona horaria a propósito para aritmética de calendario, pero "cuál es el mes actual" sí depende de la hora real, para eso existe justamente `APP_TIMEZONE`).

Lo único que sigue exigiendo `DRAFT` sin ninguna excepción de fecha es **generar/regenerar el horario** y **(re)sortear equipos** — ambas acciones reconstruyen el mes desde cero, no tiene sentido permitirlas sobre un mes ya público. Todo lo demás en la tabla de arriba usa `assertEditableConsideringFinalization` (`server/src/utils/monthLifecycle.js`).

---

## 1. Esquema

Agregar a `ServiceSlot`:
```prisma
/// No nulo únicamente cuando el admin canceló un evento EXTRAORDINARY después
/// de publicado (o antes, no hay restricción). El slot queda, se ve, pero
/// deja de necesitar equipo: se le limpian sus SlotAssignment y se le pone
/// countsTowardBalance = false (mismo mecanismo que ya usaba SPECIAL/
/// YOUTH_SERVICE para "no cuenta al balance", reutilizado tal cual).
cancelledAt DateTime? @map("cancelled_at")
```
CHECK nuevo (SQL crudo en la migración, mismo estilo que las demás): `cancelled_at IS NULL OR slot_type = 'EXTRAORDINARY'` — solo un evento extraordinario puede cancelarse (los turnos `FIXED`/`YOUTH_SERVICE` no tienen ese concepto).

Migración: `npx prisma migrate dev --name phase4c_cancel_event_and_past_month_guard` (o escribir el SQL a mano si el entorno no permite el modo interactivo, mismo criterio ya usado en migraciones anteriores de este proyecto).

`SLOT_SELECT`/`serializeSlot` (`scheduleGeneration.service.js`, compartidos con `events.service.js` y `slots.service.js`): agregar `cancelledAt: true` al select y `cancelledAt: slot.cancelledAt` (ISO string o `null`) al objeto serializado.

---

## 2. Utilidad de fecha "hoy" (`server/src/utils/dates.js`)

Nueva función, siguiendo el estilo del archivo pero usando `APP_TIMEZONE` a propósito (es el único lugar de este archivo donde corresponde, ver comentario de arriba):
```js
/** Fecha civil {year, month, day} de "hoy" en APP_TIMEZONE (no la hora del proceso). */
export function currentCivilDate(timeZone) { ... }
```
Implementación sugerida: `Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())` da `"YYYY-MM-DD"` de forma confiable, parsear a `{ year, month, day }`. El caller (`events.service.js`, `slots.service.js`) le pasa `env.APP_TIMEZONE` (`server/src/config/env.js`, ya existe).

---

## 3. Nueva regla de permisos compartida

En `events.service.js` (y reusada por `slots.service.js`), reemplazar el actual `assertDraft(month)` de `createEvent`/`deleteEvent` y el chequeo equivalente de `updateSlotUniform` por una función compartida (exportala de `events.service.js` o ponela en un util nuevo si te resulta más prolijo, ej. `server/src/utils/monthLifecycle.js` — usá tu criterio, pero NO la dupliques en dos archivos):

```js
function assertEditableConsideringFinalization(month) {
  if (month.status === "DRAFT") return;
  const today = currentCivilDate(env.APP_TIMEZONE);
  const isPast = month.year < today.year || (month.year === today.year && month.month < today.month);
  if (isPast) {
    throw new ConflictError("Este mes ya pasó y no admite cambios.", { code: "MES_PASADO" });
  }
  // FINALIZED pero mes actual o futuro: permitido, sigue.
}
```
**Estado al 2026-08-08:** `PATCH /api/events/:eventId` (editar completo) y todo lo demás de la tabla de §0 que en ese momento seguía bloqueado usaban el `assertDraft` de siempre, sin cambios. **Ya no es así desde el 2026-08-25** — `updateEvent` migró a `assertEditableConsideringFinalization`, ver §11a. Lo único que sigue con `assertDraft` incondicional (nunca migró) es generar/regenerar horario y (re)sortear equipos.

---

## 4. `events.service.js`

- **`createEvent`**: usar `assertEditableConsideringFinalization` en vez de `assertDraft`. Después de crear el `ServiceSlot`:
  - Si `month.status === "DRAFT"`: `recomputeBalance(tx, monthCycleId)` (completo, sin cambios respecto a hoy).
  - Si `month.status === "FINALIZED"` (ya validado que es actual/futuro): `recomputeBalance(tx, monthCycleId, { onlySlotIds: [created.id] })` (ver §6) — decide equipo(s) SOLO para el evento nuevo, sin tocar nada más.
- **`deleteEvent`**: usar `assertEditableConsideringFinalization`.
  - Si `DRAFT`: borrar + `recomputeBalance(tx, monthCycleId)` completo (sin cambios).
  - Si `FINALIZED` (actual/futuro): borrar el `ServiceSlot` (cascada borra su `SlotAssignment`) y **NO** llamar `recomputeBalance` — nada más necesita reacomodarse.
- **Nueva `cancelEvent(eventId)`**:
  1. Buscar el `ServiceSlot`; **404** `EVENTO_NO_ENCONTRADO` si no existe o no es `EXTRAORDINARY` (mismo criterio que `deleteEvent`).
  2. `assertEditableConsideringFinalization(month)`.
  3. **409** `EVENTO_YA_CANCELADO` si `cancelledAt` ya no es `null`.
  4. En una transacción: `serviceSlot.update` con `cancelledAt: new Date()`, `countsTowardBalance: false`; borrar sus `SlotAssignment` existentes (`slotAssignment.deleteMany({ where: { serviceSlotId: eventId } })` — sin importar si estaban `locked`, cancelar es una decisión explícita del admin que prevalece). **NO** llamar `recomputeBalance` (nada se reacomoda).
  5. **200** → `{ "slot": { …mismo shape que serializeSlot… } }`.
- **`updateEvent`** (edición completa): a partir de 2026-08-25 usa `assertEditableConsideringFinalization` igual que el resto (ver §11) — ya **no** está limitada a `DRAFT`. Se documenta acá para no perder el historial; el contrato vigente es el de §11.

## 5. `slots.service.js` (`updateSlotUniform`)

Reemplazar el chequeo `if (slot.monthCycle.status !== "DRAFT") throw ... MES_FINALIZADO` por `assertEditableConsideringFinalization(slot.monthCycle)` (vas a necesitar traer `year`/`month` en el `select` del `monthCycle`, hoy solo trae `status`). El resto de la función no cambia — sigue operando sobre un único `ServiceSlot`, nunca sincroniza turnos hermanos (eso siempre fue responsabilidad del frontend, ver §7).

## 6. `balance.service.js` — modo acotado de `recomputeBalance`

Agregar un segundo parámetro opcional: `recomputeBalance(tx, monthCycleId, { onlySlotIds } = {})`.

- **`onlySlotIds` ausente** (default): comportamiento IDÉNTICO al actual, sin cambios — no rompas nada de lo que ya está probado.
- **`onlySlotIds` presente** (array de ids de `ServiceSlot`, en la práctica siempre `[eventoRecienCreado.id]`):
  1. Borrar únicamente las `SlotAssignment` con `locked: false` **de esos slots** (`where: { monthCycleId, locked: false, serviceSlotId: { in: onlySlotIds } }`) — no se toca ninguna asignación fuera de ese conjunto.
  2. El conteo acumulado (`countByTeam`) y las semanas ya usadas (`weeksByTeam`) de arranque deben construirse a partir de **TODAS** las `SlotAssignment` del mes que sobrevivieron (no solo las `locked` como en el modo completo) — porque en este modo nada fuera de `onlySlotIds` se borró, así que todo lo demás sigue vigente y debe contar para que el turno nuevo se reparta parejo respecto al resto del mes ya publicado.
  3. Iterar (mismo algoritmo de selección de equipo ya documentado: preferir no repetir semana, dentro de eso menor conteo, desempate aleatorio) ÚNICAMENTE los `ServiceSlot` cuyo id esté en `onlySlotIds`.
  4. `YOUTH_SERVICE` no debería aparecer nunca en `onlySlotIds` en la práctica (los eventos nuevos post-publicación son siempre `EXTRAORDINARY`), pero si apareciera, seguí tratándolo igual que hoy (asignación directa al equipo `YOUTH`, sin competir).

No dupliques el algoritmo de selección de equipo entre el modo completo y el acotado — factorizalo en una función interna compartida si el diff queda más limpio así, es la forma correcta de extender esto sin arriesgar una divergencia entre ambos modos.

## 7. Rutas

- `events.routes.js`: nueva `POST /events/:eventId/cancel`, sin body, `requireAuth` (mismo patrón que las demás rutas de este archivo, que aplican el middleware por ruta). Llama a `cancelEvent`.
- `events.routes.js` (`createEvent`/`deleteEvent`) y `slots.routes.js` (`updateSlotUniform`): sin cambios de forma, solo cambia el código de error que puede devolver el service (`MES_PASADO` en vez de `MES_FINALIZADO`, según corresponda).

---

## 8. Frontend

**Nota (2026-08-25): esta sección describe el estado tal como quedó definido el 2026-08-08. La ronda del 2026-08-25 (§11) movió "bloquear/desbloquear", "reasignar equipo a mano" y "Editar evento" (edición completa) del primer grupo al segundo — ya no dependen solo de `monthFinalized`, dependen de `monthIsPast`, igual que agregar/cancelar/eliminar evento. Ver §11c para el detalle real vigente; el texto de abajo queda para el historial.**

Matriz completa de qué queda habilitado/deshabilitado en `EventsManager.jsx`/`ScheduleSlotCard.jsx` según el estado del mes — es la tabla de §0, tradúcela literalmente a la UI: hoy toda la pantalla usa una sola condición (`monthFinalized`) para deshabilitar acciones; hace falta separar en DOS grupos:

- **Sigue bloqueado solo por `monthFinalized`** (sin excepción de fecha): generar/regenerar horario, re-sortear equipos (esto vive en `TeamGenerator.jsx`, no lo toques), bloquear/desbloquear, reasignar equipo a mano, "Editar evento" (edición completa).
- **Nuevo grupo, bloqueado solo si el mes está finalizado Y ya pasó** (`monthFinalized && mesYaPaso`): "Agregar evento extraordinario", "Cancelar evento" (nuevo botón), "Eliminar evento", el select de uniforme por turno.

Agregá a `client/src/utils/dates.js` (el del cliente) algo como `isMonthCurrentOrFuture(year, month)` comparando contra `new Date()` del navegador (aproximación del lado cliente, el backend con `APP_TIMEZONE` es la autoridad real — un desfase de reloj mínimo entre cliente y servidor en el peor caso deshabilita/habilita mal un botón por un instante, pero el servidor igual lo rechaza con `MES_PASADO` si corresponde; no hace falta pedirle "qué fecha es hoy" al backend).

- `client/src/api/schedule.js`: agregar `cancelEvent(eventId)` → `POST /events/:eventId/cancel`.
- `ScheduleSlotCard.jsx`: nuevo botón "Cancelar evento" junto a "Eliminar evento" (mismo `canDelete = slotType === 'EXTRAORDINARY'`, pero además ocultalo si `slot.cancelledAt` ya tiene valor — no se puede cancelar dos veces). Con `ConfirmDialog` propio (mismo patrón que "Eliminar evento"). Los controles que dependen del nuevo grupo de arriba (agregar/cancelar/eliminar/uniforme) usan la condición nueva, NO la vieja `disabled` que ya recibe el componente (esa sigue atada 1:1 a `monthFinalized`, se usa para lock/reasignación/editar-evento-completo).
- **Turno cancelado, tratamiento visual** (`ScheduleSlotCard.jsx` Y `SlotCard.jsx`, el de solo lectura de la página pública): si `slot.cancelledAt`, mostrar el título tachado (o un estilo equivalente claramente distinto) + una etiqueta "Cancelado" — en vez del mensaje actual "Sin equipo asignado todavía" (que significa algo distinto: "todavía no se asignó", no "se canceló"). En `ScheduleSlotCard.jsx`, ocultar el select de reasignación/lock y el select de uniforme para un turno ya cancelado (no queda nada que gestionar ahí salvo "Eliminar evento", que sigue disponible para purgarlo del todo si hace falta).
- **`MonthOccupancyCalendar.jsx`** (usado tanto en `EventsManager` como en `PublicSchedule`): el indicador de un evento `EXTRAORDINARY` cancelado debe distinguirse visualmente (ej. texto tachado) de uno activo, en vez de mezclarse como si nada.
- **Sincronización de uniforme entre servicios del mismo día** (turnos `FIXED`): hoy, cambiar el uniforme de un turno fijo sincroniza automáticamente el turno hermano de la misma fecha (mismo día, otra franja horaria) — ESO SOLO DEBE SEGUIR PASANDO CUANDO EL MES ESTÁ `DRAFT`. Cuando el mes ya está `FINALIZED` (aunque sea actual/futuro y por lo tanto editable), cambiar el uniforme de un turno debe afectar ÚNICAMENTE ESE turno puntual, sin tocar el hermano — pedido explícito del usuario ("esto no afectaría todo el día").
- Mapear el nuevo código `MES_PASADO` a un mensaje claro (ej. "Este mes ya pasó, no se puede modificar.") en los mismos lugares donde hoy se mapea `MES_FINALIZADO`. Mapear `EVENTO_YA_CANCELADO` también, aunque en la práctica no debería alcanzarse desde la UI si el botón se oculta correctamente cuando ya está cancelado (dejalo como red de seguridad).

---

## 10. Ampliación 2026-08-25 — Cancelar / eliminar el Servicio de jóvenes

Antes de esta ronda, la única forma de quitar el equipo de jóvenes (`Team.teamType = YOUTH`) de un mes era volver a correr `POST /api/months/:id/generate-teams` con `youthTeam.enabled: false`, lo que re-sorteaba **todo** el mes (equipos regulares incluidos). Ahora hay dos acciones puntuales, implementadas en `server/src/services/youthTeam.service.js` (archivo nuevo, separado de `teamGeneration.service.js`/`events.service.js` a propósito — ver el comentario de cabecera del archivo: evita un ciclo de imports ESM con `publicSchedule.service.js`).

Ambas usan `assertEditableConsideringFinalization` (sin restricción en `DRAFT`; en `FINALIZED`, solo si el mes es el actual o uno futuro, `409 MES_PASADO` si no) y ninguna llama a `recomputeBalance`: el equipo `YOUTH` nunca compite por el balance de los equipos `REGULAR`, así que cancelar/eliminar no tiene nada que reacomodar.

### 10.1 `POST /api/months/:id/youth-team/cancel`

Cancela (no elimina) el `ServiceSlot` de tipo `YOUTH_SERVICE` del mes — mismo mecanismo `cancelledAt`/`countsTowardBalance: false` que ya usa `cancelEvent` para eventos `EXTRAORDINARY` (§4), incluida la limpieza de sus `SlotAssignment` (cancelar prevalece sobre `locked`). El `Team` `YOUTH` y sus integrantes **no se tocan**.

- **Auth:** `requireAuth` + `adminLimiter`.
- **Params:** `id` = id del `MonthCycle`.
- **Body:** ninguno.
- **200:**
  ```json
  {
    "slot": {
      "id": "slot-uuid",
      "slotType": "YOUTH_SERVICE",
      "date": "2026-08-29",
      "startTime": "18:50",
      "title": "Servicio de jóvenes",
      "teamsNeeded": 1,
      "countsTowardBalance": false,
      "cancelledAt": "2026-08-25T14:03:11.000Z",
      "uniformId": null
    }
  }
  ```
- **Errores:**
  - `404 Mes no encontrado.` — el `id` no corresponde a ningún `MonthCycle`.
  - `404 SERVICIO_JOVENES_NO_ENCONTRADO` — "Este mes no tiene un turno de Servicio de jóvenes generado." (el mes no tiene equipo de jóvenes, o tiene equipo pero nunca se generó el horario).
  - `409 SERVICIO_JOVENES_YA_CANCELADO` — "El Servicio de jóvenes ya está cancelado." (`cancelledAt` ya no es `null`).
  - `409 MES_PASADO` — "Este mes ya pasó y no admite cambios." (mes `FINALIZED` con `(year, month)` anterior al mes civil actual).

### 10.2 `DELETE /api/months/:id/youth-team`

Elimina por completo el equipo de jóvenes del mes: borra el `ServiceSlot` `YOUTH_SERVICE` (cascada borra sus `SlotAssignment` restantes) y el `Team` `YOUTH` (cascada borra sus `TeamMember`), y pone `youthTeamEnabled: false` en el `MonthCycle` — este último campo no gobierna nada del sorteo ya corrido, solo es el default que la UI precarga la próxima vez que se abra el modal de "Sortear equipos", así que escribirlo acá es seguro.

- **Auth:** `requireAuth` + `adminLimiter`.
- **Params:** `id` = id del `MonthCycle`.
- **Body:** ninguno.
- **200:**
  ```json
  { "deleted": true }
  ```
- **Errores:**
  - `404 Mes no encontrado.` — el `id` no corresponde a ningún `MonthCycle`.
  - `404 EQUIPO_JOVENES_NO_ENCONTRADO` — "Este mes no tiene un equipo de jóvenes." (el mes nunca tuvo equipo `YOUTH`, o ya se eliminó).
  - `409 MES_PASADO` — igual criterio que arriba.

Notar que **cancelar** y **eliminar** son independientes: se puede eliminar el equipo `YOUTH` directamente sin cancelarlo antes (el turno cae en cascada igual), y se puede cancelar el turno sin eliminar el equipo (el equipo sigue existiendo y visible en «Equipos», solo que ya no tiene turno asignado en el horario).

### 10.3 Frontend

- `client/src/api/schedule.js` → `cancelYouthService(monthId)`, mismo `POST` de arriba.
- `client/src/api/months.js` → `deleteYouthTeam(id)`, mismo `DELETE` de arriba, junto a `deleteMonth`.
- **«Horario y eventos» (`EventsManager.jsx`):** la tarjeta del turno `YOUTH_SERVICE` (`ScheduleSlotCard.jsx`) ofrece "Cancelar Servicio de jóvenes" — mismo botón/`ConfirmDialog` que "Cancelar evento", ramificado por `slotType` (`cancelTargetIsYouth = cancelTarget?.slotType === 'YOUTH_SERVICE'`). El turno cancelado se muestra tachado con la etiqueta "Cancelado", igual que un evento extraordinario cancelado.
- **«Equipos» (`TeamGenerator.jsx`):** la tarjeta del equipo `YOUTH` ofrece "Eliminar equipo de jóvenes", con `ConfirmDialog` propio.
- Ambas acciones se deshabilitan con el motivo visible cuando `monthIsPast` (mes `FINALIZED` y ya pasado) — mismo patrón que el botón "Eliminar mes".
- Códigos nuevos traducidos a texto plano en ambas pantallas: `SERVICIO_JOVENES_NO_ENCONTRADO`, `SERVICIO_JOVENES_YA_CANCELADO`, `EQUIPO_JOVENES_NO_ENCONTRADO`, además del ya existente `MES_PASADO`.

### 10.4 Esquema — nueva migración

Antes de esta ronda, la base de datos rechazaba físicamente cancelar cualquier `ServiceSlot` que no fuera `EXTRAORDINARY` (CHECK `service_slot_cancelled_only_extraordinary`, de la migración de §1/2026-08-08). Como `cancelYouthService` necesita poner `cancelledAt` en un slot `YOUTH_SERVICE`, hizo falta ampliar ese CHECK:

`server/prisma/migrations/20260825000000_youth_service_cancellable/migration.sql`:
```sql
ALTER TABLE "service_slot" DROP CONSTRAINT "service_slot_cancelled_only_extraordinary";

ALTER TABLE "service_slot"
  ADD CONSTRAINT "service_slot_cancelled_only_cancellable_types"
      CHECK ("cancelled_at" IS NULL OR "slot_type" IN ('EXTRAORDINARY', 'YOUTH_SERVICE'));
```

Los turnos `FIXED` siguen sin poder cancelarse individualmente (verificado por QA contra la base real: sigue rechazado a nivel de constraint). Escrita a mano, no generada con `prisma migrate dev` (entorno no interactivo de la sesión), siguiendo el mismo estilo que las migraciones anteriores del proyecto.

---

## 11. Ampliación 2026-08-25 — Ventana de edición extendida a tres acciones más

Las tres acciones que en la tabla de §0 (versión 2026-08-08) figuraban como "❌ `MES_FINALIZADO` sin excepción" pasan a usar `assertEditableConsideringFinalization` — el mismo mecanismo que ya regía agregar/cancelar/eliminar eventos y cambiar el uniforme de un turno puntual. `DELETE /api/months/:id` (eliminar el mes entero) no cambió, sigue con el mismo criterio de siempre.

### 11a. `PATCH /api/events/:eventId` (`updateEvent`, `server/src/services/events.service.js`)

- Cambia de `assertDraft` (exigía `DRAFT` sin excepción) a `assertEditableConsideringFinalization(slot.monthCycle)`.
- El `recomputeBalance` posterior a la actualización queda **condicional**, igual que ya hacía `createEvent`:
  - Mes `DRAFT`: `recomputeBalance(tx, monthCycleId)` completo, sin cambios respecto al comportamiento histórico.
  - Mes `FINALIZED` (ya validado actual/futuro): `recomputeBalance(tx, monthCycleId, { onlySlotIds: [eventId] })` — decide equipo(s) solo para el evento editado, nunca reordena ninguna otra asignación ya pública (misma regla de negocio de `CLAUDE.md`, sección "Eventos extraordinarios").
- Invalida el caché público (`invalidatePublicCache(year, month)`) tras el `update` — antes de esta ronda `updateEvent` era el único de los cuatro handlers de eventos que no lo hacía, porque hasta ahora nunca podía tocar un mes ya cacheado.
- Errores sin cambios de forma (`EVENTO_NO_ENCONTRADO`, `FECHA_FUERA_DE_MES`, `UNIFORME_NO_VALIDO`, `EQUIPOS_BLOQUEADOS_EXCEDEN_CUPO`); el único código nuevo posible es `409 MES_PASADO` en vez del viejo `MES_FINALIZADO` incondicional.

### 11b. `PATCH /api/assignments/:id` (`updateAssignment`, `server/src/services/assignments.service.js`)

- El `include` de `serviceSlot.monthCycle` amplía su `select` a `{ year, month, status }` (antes solo `{ status }`, necesario para que `assertEditableConsideringFinalization` pueda comparar contra el mes civil actual).
- Cambia de `assertDraft` a `assertEditableConsideringFinalization(assignment.serviceSlot.monthCycle)`.
- Invalida el caché público tras el `update` (este archivo no importaba `lib/cache.js` antes de esta ronda).
- Sin cambios en la regla `ASIGNACION_JOVENES_NO_EDITABLE`: el equipo de un turno `YOUTH_SERVICE` sigue sin poder reasignarse a mano (siempre es directamente el equipo `YOUTH` del mes).
- Único código nuevo posible: `409 MES_PASADO` en vez de `MES_FINALIZADO` incondicional.

### 11c. `PATCH /api/teams/:teamId` (`updateTeam`/`updateTeamTransaction`, `server/src/services/teamGeneration.service.js`)

- El `include` de `monthCycle` amplía su `select` a `{ id, year, month, status }` (antes `{ id, status }`).
- Cambia de `assertDraft` a `assertEditableConsideringFinalization(team.monthCycle)`.
- Invalida el caché público con `invalidateByPrefix("schedule:")` (más ancho que la clave puntual `schedule:${year}:${month}` que usan `events.service.js`/`assignments.service.js`/`youthTeam.service.js` — este archivo no puede importar `cacheKeyFor` desde `publicSchedule.service.js` sin cerrar el mismo ciclo de imports mencionado en §10; `invalidateByPrefix` es el mismo helper que ya usan `deleteMonthCycle`/`finalizeMonthCycle` en este archivo).
- Único código nuevo posible: `409 MES_PASADO` en vez de `MES_FINALIZADO` incondicional.

### 11d. Frontend

- `EventsManager.jsx`: la vista de lista usa `disabled={monthIsPast}` (antes `disabled={monthFinalized}`) en `ScheduleSlotCard` para lock/desbloqueo, reasignación de equipo y "Editar evento" completo — quedan habilitadas en un mes `FINALIZED` actual/futuro. El texto del aviso de mes finalizado y la descripción del diálogo de "Finalizar mes" se actualizaron para reflejar esto (ya no dicen que finalizar bloquea "todo", aclaran que solo bloquean re-sortear equipos y regenerar el horario).
- `TeamGenerator.jsx`: el botón "Editar integrantes" de cada `TeamCard` pasa de `disabled={monthFinalized}` a `disabled={monthIsPast}` — es la misma acción que "editar la composición de un equipo" de §11c. "Sortear equipos"/"Re-sortear equipos" y "Crear mes nuevo" **no cambiaron**, siguen exigiendo `DRAFT` sin excepción.
- `ScheduleSlotCard.jsx`: el JSDoc de la prop `disabled` se actualizó (ya no dice "atado 1:1 a `monthFinalized`, sin excepción de fecha"; ahora es `monthIsPast`, calculado igual que `eventActionsDisabled`).

---

## 12. Fuera de alcance (a propósito)

- No hay forma de "descancelar" un evento ni el Servicio de jóvenes — si se canceló por error, hay que crear uno nuevo (evento) o volver a sortear/generar equipos (Servicio de jóvenes). Se puede agregar después si hace falta.
- ~~`PATCH /api/events/:eventId` (edición completa) sigue completamente bloqueado una vez `FINALIZED`~~ — vigente hasta el 2026-08-08. Ampliado el 2026-08-25 a la ventana `FINALIZED` actual/futuro, ver §11a. Ya no es una limitación de esta fase.
- Los turnos `FIXED` no se pueden cancelar individualmente (solo `EXTRAORDINARY` y, desde 2026-08-25, `YOUTH_SERVICE` — ver §10) — no se pidió lo contrario. Re-sortear equipos y regenerar el horario siguen siendo la única forma de modificar turnos `FIXED` en bloque.
- No hay forma de "des-eliminar" el equipo de jóvenes tras `DELETE /api/months/:id/youth-team` — para recuperarlo hay que volver a sortear los equipos del mes (`POST /api/months/:id/generate-teams` con `youthTeam.enabled: true`), lo que en un mes `DRAFT` reconstruye todo el mes desde cero, y en un mes `FINALIZED` directamente no es posible (re-sortear exige `DRAFT` sin excepción).

## Nota abierta — condición de carrera menor en las funciones "cancelar" (no introducida el 2026-08-25, preexistente)

`cancelEvent` (desde 2026-08-08) y ahora también `cancelYouthService` (2026-08-25) siguen el mismo patrón: leer el recurso, verificar `cancelledAt === null`, y recién después escribir `cancelledAt`. Dos requests simultáneos cancelando el mismo recurso pueden pasar ambos la verificación antes de que el primero escriba, y devolver ambos `200` en vez de un `200` + un `409 EVENTO_YA_CANCELADO`/`SERVICIO_JOVENES_YA_CANCELADO`. No hay un guard atómico a nivel de fila (ej. `UPDATE ... WHERE cancelled_at IS NULL RETURNING *` comprobando el conteo de filas afectadas). No corrompe datos — el resultado final es el mismo recurso cancelado una sola vez — es únicamente una respuesta duplicada bajo concurrencia exacta e infrecuente (dos clicks casi simultáneos en el mismo botón, o dos pestañas del admin). Detectado por QA el 2026-08-25 al verificar el nuevo endpoint; no es un bug nuevo, es el mismo patrón que ya tenía `cancelEvent`. Si se corrige, corregir ambas funciones a la vez con el mismo mecanismo.
