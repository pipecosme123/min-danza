# Fase 4c — Edición limitada de eventos tras publicar el mes

**Estado:** cerrado para implementar. Referencia obligatoria para `backend-developer` y `frontend-developer`.
**Fecha:** 2026-08-08
**Alcance:** ajuste sobre lo ya construido en Fase 4/4b/5. No es una fase nueva del plan, es un refinamiento pedido por el usuario tras usar la Fase 5 (finalizar mes + página pública) en el navegador.

Decisiones ya confirmadas con el usuario (no hace falta volver a preguntar):
1. "Cancelar" un evento extraordinario es **distinto** de eliminarlo: el evento queda registrado y visible (marcado como cancelado), no desaparece sin dejar rastro.
2. Al agregar/cancelar/eliminar un evento en un mes **ya publicado**, el resto de las asignaciones ya publicadas queda **protegido** — el recálculo de balance solo decide el equipo del turno nuevo/afectado, nunca reordena lo que ya estaba.

---

## 0. Regla de negocio nueva

Hoy, `MonthCycle.status = FINALIZED` bloquea **toda** escritura sobre el mes (`MES_FINALIZADO` en todos lados). Esto se relaja, pero solo para tres acciones puntuales, y solo si el mes finalizado es el **actual o uno posterior** (nunca uno que ya pasó):

| Acción | Mes `DRAFT` | Mes `FINALIZED`, actual o futuro | Mes `FINALIZED`, ya pasado |
|---|---|---|---|
| Generar/regenerar horario | ✅ | ❌ `MES_FINALIZADO` | ❌ `MES_FINALIZADO` |
| Re-sortear equipos | ✅ | ❌ `MES_FINALIZADO` | ❌ `MES_FINALIZADO` |
| Bloquear/desbloquear una asignación | ✅ | ❌ `MES_FINALIZADO` | ❌ `MES_FINALIZADO` |
| Reasignar equipo a mano | ✅ | ❌ `MES_FINALIZADO` | ❌ `MES_FINALIZADO` |
| Editar evento completo (fecha/hora/título/cantidad de equipos) | ✅ | ❌ `MES_FINALIZADO` | ❌ `MES_FINALIZADO` |
| **Agregar** evento extraordinario | ✅ | ✅ | ❌ `MES_PASADO` |
| **Cancelar** evento extraordinario | ✅ | ✅ | ❌ `MES_PASADO` |
| **Eliminar** evento extraordinario | ✅ | ✅ | ❌ `MES_PASADO` |
| **Cambiar el uniforme de UN turno puntual** (`PATCH /api/slots/:id`) | ✅ | ✅ | ❌ `MES_PASADO` |

"Mes actual o posterior" = `(monthCycle.year, monthCycle.month) >= (añoActual, mesActual)`, comparado contra la fecha civil de HOY en `APP_TIMEZONE` (no la hora del proceso del servidor — mismo criterio ya establecido en `server/src/utils/dates.js`, que hoy evita zona horaria a propósito para aritmética de calendario, pero "cuál es el mes actual" sí depende de la hora real, para eso existe justamente `APP_TIMEZONE`).

`PATCH /api/events/:eventId` (edición completa) **NO** se toca — sigue bloqueado por completo una vez `FINALIZED`, sin excepción de fecha. Para cambiar SOLO el uniforme de un turno después de publicar, se usa exclusivamente `PATCH /api/slots/:id` (ya existe, ya opera sobre un único turno) — no hay dos caminos superpuestos para lo mismo.

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
`PATCH /api/events/:eventId` (editar completo) y todo lo demás de la tabla de §0 que sigue bloqueado usan el `assertDraft` de siempre, SIN cambios — no les apliques esta función nueva.

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
- **`updateEvent`** (edición completa): **sin cambios**, sigue con `assertDraft` tal cual hoy.

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

## 9. Fuera de alcance (a propósito)

- No hay forma de "descancelar" un evento en esta fase — si se canceló por error, hay que crear uno nuevo. Se puede agregar después si hace falta.
- `PATCH /api/events/:eventId` (edición completa: fecha/hora/título/cantidad de equipos) sigue completamente bloqueado una vez `FINALIZED`, sin ninguna excepción — no se pidió, no se agrega.
- Los turnos `FIXED`/`YOUTH_SERVICE` no se pueden cancelar (solo `EXTRAORDINARY`) — no se pidió lo contrario.
