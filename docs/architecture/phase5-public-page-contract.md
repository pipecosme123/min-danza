# Fase 5 — Contrato cerrado de finalización de mes y página pública

**Estado:** cerrado para implementar. Referencia obligatoria para `backend-developer` y `frontend-developer`.
**Fecha:** 2026-08-08
**Alcance:** `POST /api/months/:id/finalize` (nuevo, admin), `GET /api/schedule/latest`, `GET /api/schedule/history` y `GET /api/schedule/:year/:month` (públicos, reemplazan el stub `501`), y la pantalla `PublicSchedule.jsx` real.

Decisión original de Fase 5 (2026-08-08): la página pública muestra solo el mes finalizado más reciente, sin selector ni historial. **Revertida el 2026-08-22**: ahora se puede consultar además cualquier mes `FINALIZED` anterior, hasta 1 año de antigüedad (`PUBLIC_HISTORY_MONTHS = 12`, `services/publicSchedule.service.js`). El límite de la ventana de historial es estrictamente hacia atrás.

Además, el mismo día se ajustó qué significa "el mes por defecto" (`GET /latest`): ya no es literalmente "el `FINALIZED` con `(year, month)` más grande" — es el mes civil actual si está publicado, o si no, el más reciente hacia atrás. **Nunca** un mes con fecha posterior a hoy, aunque exista uno ya finalizado por anticipado (ej. el admin publicó el mes siguiente antes de tiempo) — quien visita la página hoy debe ver "lo que corresponde a hoy", no adelantarse.

Fuentes: `CLAUDE.md` §Acceso, `docs/architecture/phase1-schema-design.md` (comentario de `schedule.routes.js`, `lib/cache.js` ya escrito de antemano para esto), `docs/architecture/phase3-teams-contract.md` (`TEAM_SELECT`/`serializeTeam`), `docs/architecture/phase4-schedule-contract.md` (`SLOT_SELECT`/`serializeSlot`).

---

## 0. Regla de negocio

- Un `MonthCycle` nace `DRAFT` y puede pasar a `FINALIZED` una sola vez, a mano, por el admin. **No hay "des-finalizar"** en esta fase (fuera de alcance, ver §5).
- Un mes `FINALIZED` es **inmutable**: ya está protegido en todos lados por el chequeo `MES_FINALIZADO` que existe desde Fase 3-4 (`generate-teams`, `generate-schedule` con `regenerate`, eventos, asignaciones, uniforme de un turno). Finalizar no agrega ningún candado nuevo, solo cambia el estado que esos chequeos ya usan.
- La página pública **nunca** distingue entre "no existe" y "existe pero está en `DRAFT`" — ambos casos devuelven el mismo 404 público, para no filtrar que hay un mes en preparación.

---

## 1. `POST /api/months/:id/finalize`

Nuevo, en `months.routes.js` → `teamGeneration.service.js` (mismo archivo que ya tiene el resto del ciclo de vida de `MonthCycle`: `createMonthCycle`/`getMonthCycle`).

Sin body.

- **404** si el mes no existe.
- **409** `MES_YA_FINALIZADO` si `status` ya es `FINALIZED`.
- **409** `MES_INCOMPLETO` si falta algo para que tenga sentido publicarlo — `details: { hasTeams: boolean, hasSchedule: boolean }`:
  - `hasTeams` = existe al menos un `Team` `teamType: REGULAR` de ese mes.
  - `hasSchedule` = existe al menos un `ServiceSlot` de ese mes.
  - Si cualquiera de los dos es `false`, se rechaza (no tiene sentido publicar un mes sin equipos o sin horario).
- **409** `TURNOS_SIN_UNIFORME` (agregado 2026-08-22) si algún `ServiceSlot` de ese mes **no cancelado** (`cancelledAt: null`) tiene `uniformId: null` — `details: { slots: [{ id, date, startTime, slotType, title }, ...] }`, ordenado por fecha/hora. Los turnos **cancelados** quedan exentos: ya no necesitan equipo ni cuentan al balance, así que tampoco tiene sentido exigirles uniforme. Se chequea después de `MES_INCOMPLETO` (solo tiene sentido evaluarlo si ya hay equipos y horario).
- Éxito: `status = FINALIZED`, `finalizedAt = now()`. Invalidar el caché público (`invalidateByPrefix("schedule:")` de `lib/cache.js` — defensivo, ver §3, no es estrictamente necesario porque un mes que recién se finaliza nunca estuvo cacheado antes, pero es barato y evita sorpresas si algún día se agrega des-finalizar).
- **200** → mismo DTO de `MonthCycle` que ya devuelven `GET /api/months`/`POST /api/months` (incluye `finalizedAt` ya no nulo).

Frontend: el botón "Finalizar mes" vive en `EventsManager.jsx` (es la pantalla que ya sabe si el mes tiene equipos y horario — mismas condiciones `hasRegularTeams`/`slots.length > 0` que ya usa para sus propios estados vacíos), con un `ConfirmDialog` (irreversible, no hay forma de deshacerlo en esta fase) antes de confirmar. Deshabilitado (con el motivo visible) si el mes ya está finalizado, si falta algo, o (agregado 2026-08-22) si algún turno no cancelado todavía no tiene uniforme asignado (`slotsWithoutUniform`, calculado localmente sobre los `slots` ya cargados — mismo criterio que el backend). Reusar el mapeo de errores existente para `MES_INCOMPLETO` y `TURNOS_SIN_UNIFORME`.

---

## 2. Payload público compartido

Ambos endpoints públicos devuelven el mismo shape:

```json
{
  "month": { "year": 2026, "month": 8, "finalizedAt": "2026-08-08T20:00:00.000Z" },
  "teams": [ /* mismo shape que GET /api/months/:id/teams -> teams[] (label, orderIndex, teamType, members[]) */ ],
  "slots": [ /* mismo shape que GET /api/months/:id/schedule -> slots[] (date, startTime, slotType, title, teamsNeeded, uniform, teams[]) */ ]
}
```

No incluye `balance` (los conteos de participación son una herramienta de administración, no hace falta exponerlos públicamente — no se pidió y no aporta a "equipos, integrantes y horarios asignados"). No incluye ningún dato de `Person` más allá de `fullName` (ya es lo único que exponen `serializeTeam`/`TEAM_SELECT`, sin cambios).

Nuevo `server/src/services/publicSchedule.service.js`:
- Reexportar/reusar `TEAM_SELECT`+`serializeTeam` de `teamGeneration.service.js` y `SLOT_SELECT`+`serializeSlot` de `scheduleGeneration.service.js` — si no están exportados hoy, exportarlos (mismo patrón que ya se usó para compartir `SLOT_SELECT`/`serializeSlot` entre `scheduleGeneration.service.js` y `events.service.js`).
- `buildPublicPayload(monthCycle)`: arma el objeto de arriba a partir de un `MonthCycle` ya confirmado `FINALIZED`. Usa el caché (`getCached`/`setCached` de `lib/cache.js`, clave `schedule:${year}:${month}`, **sin TTL** — un mes `FINALIZED` es inmutable por diseño, así que no hace falta expiración, solo la primera lectura después de finalizar lo puebla).
- `getPublicScheduleFor(year, month)`: busca el `MonthCycle` por `(year, month)`; si no existe O `status !== FINALIZED` → `NotFoundError` con mensaje genérico (mismo mensaje en ambos casos, no distinguir). Si existe y es `FINALIZED`, devuelve `buildPublicPayload(...)` (cacheado).
- `getLatestPublicSchedule()`: `findFirst` sobre `MonthCycle` con `status: FINALIZED` **y** `(year, month) <= hoy` (`currentCivilDate(env.APP_TIMEZONE)`, mismo filtro que ya usa `assertEditableConsideringFinalization` para "actual o futuro" — acá es al revés, se excluye el futuro), orden `(year desc, month desc)` — esta búsqueda NO se cachea (es una consulta liviana sobre una tabla chica); una vez resuelto cuál mes es, delega en el mismo `buildPublicPayload` cacheado por mes. Si no hay ningún mes `FINALIZED` con fecha `<= hoy` → `NotFoundError` (aunque exista uno futuro ya finalizado).

## 3. Rutas públicas (`server/src/routes/schedule.routes.js`, reemplaza el stub `501`)

Sin `requireAuth`, bajo `publicLimiter` (ya está montado en el archivo actual, no tocar eso).

- `GET /api/schedule/latest` → `getLatestPublicSchedule()`. **404** `MES_NO_PUBLICADO` si todavía no hay ningún mes finalizado con fecha `<= hoy` (`details: {}`). Nunca elige un mes futuro (ajustado 2026-08-22).
- `GET /api/schedule/history` (agregado 2026-08-22) → `listPublicScheduleHistory()`. Devuelve `{ months: [{ year, month }, ...] }`, solo meses `FINALIZED` dentro de la ventana de 1 año (`year desc, month desc`). Nunca incluye `DRAFT` — no revela su existencia. Registrada ANTES de `/:year/:month` para no competir con esa ruta dinámica.
- `GET /api/schedule/:year/:month` → valida `year`/`month` como enteros en rango razonable (mismas reglas que ya usa `createBodySchema` de `months.routes.js`: year 2000-2100, month 1-12; **400** si no cumplen). Si cumplen, `getPublicScheduleFor(year, month)`. **404** `MES_NO_PUBLICADO` si no existe, no está finalizado, **o quedó fuera de la ventana de 1 año hacia atrás** (agregado 2026-08-22) — mismo código/mensaje en los tres casos, a propósito, para no distinguir el motivo.

---

## 4. `PublicSchedule.jsx`

Reescribe el placeholder actual. Al montar, llama `GET /api/schedule/latest` (nuevo `client/src/api/publicSchedule.js`, sin autenticación — `apiClient` ya funciona sin token si no hay ninguno en `localStorage`, no hace falta un cliente HTTP aparte).

- **Cargando**: `Spinner` (mismo componente ya usado en el resto de la app).
- **Error de red**: `ErrorMessage` con reintentar (mismo patrón ya usado en todas las pantallas).
- **404 `MES_NO_PUBLICADO`**: NO es un error, es el estado esperado — mostrar el `EmptyState` que ya existe hoy ("Todavía no hay un mes publicado"), sin cambios en ese mensaje.
- **200**: mostrar
  - Encabezado con el mes/año (`formatMonthYear`, ya existe en `utils/dates.js`) y, opcionalmente, la fecha de publicación (`finalizedAt`) como referencia menor. Agregado 2026-08-22: si `GET /api/schedule/history` devuelve algún mes además del que ya está cargado, un `<select>` "Ver otro mes" ("Más reciente" + los demás) permite pedir ese mes puntual (`getPublicScheduleFor`), reseteando el filtro de persona activo al cambiar.
  - Sección "Equipos": una `TeamCard` por equipo (reusar tal cual, ya es de solo lectura — no pasarle `actions`), incluido el equipo `YOUTH` ("Servicio de jóvenes") si el mes lo tiene, en el mismo listado, ordenados por `orderIndex` (los datos ya vienen así).
  - Sección "Horario": `CalendarGrid` + `SlotCard` (AMBOS de solo lectura, tal cual ya existen — `SlotCard.jsx` ya está documentado como "la tarjeta de solo lectura de la página pública", no `ScheduleSlotCard`, que es la variante editable de admin). Agrupar los slots igual que ya hace `EventsManager` (por fecha civil) — podés extraer esa función de agrupado a un lugar compartido si es trivial, o replicarla, lo que sea más simple dado cómo está armado hoy.
- El pie de página con el link a "Acceso administrador" ya existe, no cambia.

No hay ninguna acción de escritura en esta pantalla — es 100% lectura.

---

## 5. Fuera de alcance en esta fase (a propósito)

- Des-finalizar un mes (volver de `FINALIZED` a `DRAFT`). Si hace falta corregir algo después de finalizar, hoy no hay forma — se resuelve en una fase posterior si el usuario lo pide.
- ~~Historial/selector de meses finalizados anteriores en la página pública~~ — implementado el 2026-08-22 (hasta 1 año de antigüedad), ver §0 y §3.
- Cualquier cambio a las pantallas de administración más allá del botón "Finalizar mes" en `EventsManager.jsx`.
