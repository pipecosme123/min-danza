# Fase 4b — Ajustes de horario, balance y uniformes

**Estado:** cerrado para implementar. Referencia obligatoria para `backend-developer` y `frontend-developer`.
**Fecha:** 2026-08-08
**Alcance:** ajustes sobre lo ya construido en Fase 4 (`docs/architecture/phase4-schedule-contract.md`), pedidos explícitamente por el usuario tras probar esa fase en el navegador. No es una fase nueva del plan, es un refinamiento de la Fase 4 ya cerrada.

Decisiones ya confirmadas con el usuario (no hace falta volver a preguntar):
1. Los defaults automáticos de uniforme por día de semana / Servicio de jóvenes se **eliminan por completo** (no quedan ni como sugerencia interna). Cada turno nace sin uniforme; se asigna a mano por fecha desde la vista de Eventos.
2. La paleta de colores predefinidos convive con la opción de color personalizado (no es una paleta cerrada).
3. En el algoritmo de balance, evitar que un equipo repita en la misma semana **manda primero**; el menor conteo acumulado desempata dentro de ese grupo (no al revés).

---

## 1. Uniformes por fecha, no por día de semana

### 1.1 Esquema

Eliminar por completo:
- Modelo `WeekdayUniform` (tabla `weekday_uniform`), su relación inversa `Uniform.weekdayUniforms`.
- Modelo `YouthServiceUniform` (tabla `youth_service_uniform`), su relación inversa `Uniform.youthServiceUniforms`.

`ServiceSlot.uniformId` (ya existe, sin cambios de forma) sigue siendo la única fuente de verdad de qué uniforme lleva un turno concreto — ya estaba diseñado para esto desde Fase 1, solo se deja de "adivinar" automáticamente su valor al generar.

Migración: `npx prisma migrate dev --name phase4b_drop_weekday_youth_uniform_config`, editar el SQL generado a mano si Prisma no genera bien el `DROP TABLE`/`DROP CONSTRAINT` de las FKs, mismo estilo que las migraciones anteriores de este proyecto.

### 1.2 `scheduleGeneration.service.js`

- `generateSchedule`: quitar toda lectura de `WeekdayUniform`/`YouthServiceUniform`. Cada `ServiceSlot` (FIXED, YOUTH_SERVICE) se crea con `uniformId: null` siempre.
- Quitar los warnings `UNIFORME_MIERCOLES_NO_CONFIGURADO`, `UNIFORME_DOMINGO_NO_CONFIGURADO`, `UNIFORME_JOVENES_NO_CONFIGURADO` — ya no aplican, no hay nada que "no esté configurado" porque no hay configuración automática.

### 1.3 Nuevo endpoint: asignar/cambiar el uniforme de UN turno puntual

`PATCH /api/slots/:id` — funciona para cualquier `slotType` (`FIXED`, `YOUTH_SERVICE`, `EXTRAORDINARY`), es la vía genérica de "elegí el uniforme de este turno". Nuevo router `server/src/routes/slots.routes.js` (mismo estilo que `assignments.routes.js`), montado en `routes/index.js`.

Body: `{ "uniformId": "clx…" | null }` (`null` limpia el uniforme del turno).

- **404** `TURNO_NO_ENCONTRADO` si el `ServiceSlot` no existe.
- **409** `MES_FINALIZADO` si el mes del turno no está `DRAFT`.
- **400** `UNIFORME_NO_VALIDO` si `uniformId` no es `null` y no existe o no está `active`.
- **200** → `{ "slot": { …mismo shape que ya devuelve `serializeSlot`… } }`.

No hay endpoint de "asignar uniforme a una fecha completa" en el backend: cuando el admin cambia el uniforme de un turno fijo, el FRONTEND es responsable de llamar este mismo endpoint para cada `ServiceSlot` `FIXED` que comparta esa fecha (como mucho 2: miércoles 17:00/19:00, o domingo 08:00/10:30 — salvo el último domingo, que ya es un solo `ServiceSlot`), para que "ambos servicios" del día queden con el mismo uniforme sin que el admin tenga que repetir la acción. Ver §1.5.

### 1.4 `uniforms.routes.js` / `uniforms.service.js`

Eliminar por completo: `GET/PATCH /api/uniforms/weekday-config`, `GET/PATCH /api/uniforms/weekday-config/:weekday`, `GET/PATCH /api/uniforms/youth-service-config`, y las funciones de servicio correspondientes (`listWeekdayUniforms`, `updateWeekdayUniform`, `getYouthServiceUniform`, `updateYouthServiceUniform`). Quedan solo: `GET /api/uniforms`, `POST /api/uniforms`, `PATCH /api/uniforms/:id` — CRUD puro, sin ningún endpoint de "configuración" o "asignación".

### 1.5 Frontend — `EventsManager.jsx` / `ScheduleSlotCard.jsx`

- Quitar `getWeekdayUniforms`, `getYouthServiceUniform` y toda la lógica de `suggestUniformForDate` — ya no existen esos endpoints.
- `ScheduleSlotCard.jsx`: agregar un selector de uniforme por turno (select con los uniformes activos + opción "Sin uniforme"), visible siempre (no solo para `EXTRAORDINARY`). Al cambiarlo:
  - Si el slot es `FIXED`: `EventsManager` (que tiene el array completo de `slots`) busca todos los `ServiceSlot` `FIXED` del mismo `date` y llama `PATCH /api/slots/:id` para cada uno con el mismo `uniformId` (en paralelo, `Promise.allSettled`, mismo patrón que ya se usa para acciones en lote en `PeopleManager.jsx` — si alguno falla, avisar cuál).
  - Si el slot es `YOUTH_SERVICE` o `EXTRAORDINARY`: un solo `PATCH /api/slots/:id` (el slot es único ese día, no hay "hermanos" que sincronizar).
  - El selector de uniforme del turno `EXTRAORDINARY` puede quedar duplicado con el que ya existe dentro de "Editar evento" (§4) — está bien que ambos existan, son dos formas de llegar a la misma acción (edición rápida en la tarjeta vs. edición completa del evento).

---

## 2. Balance: preferir no repetir equipo en la misma semana

### 2.1 Definición de "semana"

Semana ISO (lunes a domingo). Agregar a `server/src/utils/dates.js`:
```js
/** Fecha civil {year,month,day} del lunes de la semana ISO que contiene `civilDate`. */
export function mondayOfWeek(civilDate) { ... }
```
(mismo estilo aritmético del resto del archivo: `Date.UTC` como calculadora de calendario, sin zona horaria). Con esta definición, el turno de miércoles y el turno de domingo inmediato siguiente caen en la MISMA semana ISO (miércoles es el día 3 de la semana, domingo el día 7) — coincide con el ritmo real del ciclo de servicio de esta organización.

### 2.2 Algoritmo (`balance.service.js`, reemplaza el actual `recomputeBalance`)

Sigue corriendo dentro de una transacción, sigue respetando `locked: true` sin tocarlas, sigue recorriendo los `ServiceSlot` con `countsTowardBalance: true` en orden `(date ASC, startTime ASC)`. Cambia el criterio de selección de equipo:

1. Borrar las `SlotAssignment` del mes con `locked = false` (igual que hoy).
2. Antes de iterar, calcular para cada `Team` `teamType: REGULAR` del mes: su conteo acumulado actual (a esta altura, solo cuenta lo que quedó `locked`) y el conjunto de semanas (`mondayOfWeek` de cada slot) en las que ya tiene una asignación `locked`. Estos dos valores se actualizan EN MEMORIA a medida que el algoritmo asigna más turnos (no se vuelve a consultar la base en cada paso).
3. Para cada slot con `countsTowardBalance: true`, por cada posición libre que necesite (`teamsNeeded` menos asignaciones `locked` ya existentes en ese slot):
   a. `candidatos` = equipos `REGULAR` del mes que todavía no están asignados a ESTE slot (sin repetir equipo dentro del mismo slot, igual que hoy).
   b. Particionar `candidatos` en `sinUsarEstaSemana` (su conjunto de semanas no incluye la semana de este slot) y `yaUsadosEstaSemana`.
   c. `pool` = `sinUsarEstaSemana` si no está vacío; si no, `yaUsadosEstaSemana` (acá es donde "no es restricción" se relaja: solo cuando ya no queda alternativa).
   d. Dentro de `pool`, elegir el de menor conteo acumulado; desempate aleatorio entre los que compartan el mínimo.
   e. Crear la `SlotAssignment` (`slotIndex` = 0 o 1, el que esté libre), incrementar en memoria el conteo del equipo elegido y agregar la semana de este slot a su conjunto de semanas usadas.
4. El slot `YOUTH_SERVICE` sigue sin pasar por este algoritmo: va directo al único `Team` `teamType: YOUTH` del mes, sin competir por balance ni por "semana" (sin cambios respecto a Fase 4).

### 2.3 Tests

Como el desempate final es aleatorio, los tests deben verificar propiedades estructurales, no una asignación exacta: ejemplo, un mes con pocos equipos (2-3) y suficientes slots en una semana para que sea matemáticamente posible evitar repetidos esa semana con los equipos disponibles → confirmar que efectivamente no repite. Y un caso con MENOS equipos que slots-por-semana (repetir es inevitable) → confirmar que el algoritmo igual asigna a todos los slots (no se traba ni deja slots sin asignar) y que, dentro de eso, respeta el criterio de menor conteo. Confirmar también que `locked` sigue intacto y que el slot `YOUTH_SERVICE` nunca entra en este cálculo.

---

## 3. La vista de Uniformes vuelve a ser CRUD puro

`UniformsManager.jsx`: eliminar las secciones "Uniforme por día de semana" y "Uniforme del Servicio de jóvenes" por completo (ver §1.4, esos endpoints ya no existen). La pantalla queda con:

- Listado numerado (misma columna "#" que ya existe en `PeopleManager.jsx`, mismo criterio de numeración absoluta si en algún momento se pagina — hoy la lista de uniformes es chica y no está paginada, así que alcanza con el índice del array ya cargado).
- Filtros, TODOS del lado del cliente (la lista completa ya se trae de una sola vez con `GET /api/uniforms`, sin paginación — no hace falta tocar el backend para esto):
  - **Nombre**: texto libre, `contains` case-insensitive sobre `name` (mismo patrón de búsqueda debounced que ya existe en `PeopleManager`).
  - **Color**: select con las opciones de la paleta predefinida (§4) que efectivamente estén en uso entre los uniformes cargados, más "Todos los colores". Compara por `colorHex` exacto.
  - **Estado**: `Activo` / `Inactivo` / `Todos` (mismo patrón ya usado en `PeopleManager` para personas).
- El resto (alta, edición, activar/desactivar) sigue igual que hoy.

---

## 4. Paleta de colores predefinidos

Nuevo componente reutilizable `client/src/components/ui/ColorPalettePicker.jsx`: fila de swatches clicables (círculo o cuadrado con `background-color`, `aria-label` con el nombre del color, marcado visualmente el seleccionado) + un swatch adicional "Personalizado" que revela un `<input type="color">` (el que ya se usa hoy) para cualquier otro valor. Se usa en el form de alta/edición de `UniformsManager.jsx` en lugar del `Field type="color"` actual.

Paleta fija (nombre en español + hex):

| Nombre | Hex |
|---|---|
| Azul | `#1E40AF` |
| Rojo | `#DC2626` |
| Verde | `#16A34A` |
| Amarillo | `#EAB308` |
| Naranja | `#EA580C` |
| Morado | `#7C3AED` |
| Rosado | `#DB2777` |
| Celeste | `#0EA5E9` |
| Gris | `#6B7280` |
| Negro | `#111827` |
| Blanco | `#F9FAFB` (con borde visible, es casi blanco puro — hoy `UniformBadge` ya pone el swatch sobre fondo de la tarjeta, confirmar que se distingue en ambos temas) |
| Café | `#92400E` |

Si el `colorHex` actual de un uniforme (al editar) no coincide con ningún valor de la paleta, el picker debe abrir directamente en modo "Personalizado" con ese valor precargado, no perder el dato ni forzar a elegir uno de la paleta.

---

## 5. Eventos extraordinarios

### 5.1 Editar en vez de eliminar+recrear

Nuevo `PATCH /api/events/:eventId` (`events.routes.js` → `events.service.js`, función `updateEvent`). Body parcial: `{ "date"?, "startTime"?, "title"?, "teamsNeeded"?, "uniformId"? }` (mismas reglas de formato que `createEvent`; `uniformId` puede venir `null` para limpiarlo).

- **404** `EVENTO_NO_ENCONTRADO` si no existe o no es `EXTRAORDINARY` (igual que `DELETE`).
- **409** `MES_FINALIZADO` si el mes no está `DRAFT`.
- **400** `FECHA_FUERA_DE_MES` si `date` viene y cae fuera del año/mes del `MonthCycle` del evento.
- **400** `UNIFORME_NO_VALIDO` si `uniformId` viene, no es `null`, y no existe o no está activo.
- **409** `EQUIPOS_BLOQUEADOS_EXCEDEN_CUPO` si `teamsNeeded` viene y es MENOR a la cantidad de `SlotAssignment` `locked: true` que ya tiene ese slot (`details: { locked, teamsNeeded }`) — no se puede reducir el cupo por debajo de lo que ya está fijado a mano; el admin tiene que desbloquear primero.
- Aplica los cambios al `ServiceSlot`, corre `recomputeBalance` (por si cambió `date`/`teamsNeeded`), devuelve `{ "slot": { … } }` (mismo shape que `createEvent`).

Frontend (`EventsManager.jsx`): botón "Editar evento" en `ScheduleSlotCard` cuando `slotType === 'EXTRAORDINARY'`, junto a "Eliminar evento". Abre el mismo modal/formulario que "Nuevo evento extraordinario" pero precargado y llamando `updateEvent` en vez de `createEvent` — factorizar el formulario compartido (fecha/hora/título/cantidad de equipos/uniforme) en un componente o función interna común para no duplicar el JSX, siguiendo el mismo criterio de reutilización ya aplicado en el resto del proyecto.

### 5.2 Regenerar horario NO borra los eventos extraordinarios

`scheduleGeneration.service.js`, rama `regenerate: true`: cambiar `serviceSlot.deleteMany({ where: { monthCycleId } })` por `serviceSlot.deleteMany({ where: { monthCycleId, slotType: { in: ["FIXED", "YOUTH_SERVICE"] } } })`. Los `ServiceSlot` `EXTRAORDINARY` (y sus `SlotAssignment`, incluidas las `locked`) quedan intactos; después de recrear los `FIXED`/`YOUTH_SERVICE`, `recomputeBalance` corre sobre TODO el mes (fijos nuevos + jóvenes nuevo + extraordinarios preexistentes), así que el balance sigue siendo correcto considerando también los eventos que ya estaban.

Frontend: actualizar el texto del `ConfirmDialog` de "Regenerar horario" en `EventsManager.jsx` — ya no dice que borra los eventos extraordinarios (eso cambió), aclarar que solo se regeneran los turnos fijos y el Servicio de jóvenes, y que el balance se recalcula considerando también los eventos extraordinarios ya creados.

**Nota de alcance**: esto NO cambia el comportamiento de re-sortear EQUIPOS (`generate-teams`, Fase 3-4 §9) — ese endpoint sigue borrando TODO el horario del mes (incluidos los eventos extraordinarios) cuando el mes ya tenía uno, porque cambiar de equipos rompe cualquier asignación existente de raíz. Solo se pidió preservar eventos al regenerar el HORARIO, no al re-sortear equipos.

---

## 6. Vista de calendario del mes

Nuevo componente `client/src/components/domain/MonthOccupancyCalendar.jsx`: grilla mensual real (7 columnas, lunes a domingo, tantas filas como haga falta para cubrir el mes completo, con celdas vacías para los días de los meses vecinos que completan la primera/última semana). No reemplaza ni modifica `CalendarGrid.jsx` (que sigue siendo la vista de lista agrupada por fecha que ya usa `EventsManager` y que a futuro reusará la página pública de Fase 5) — es un componente nuevo, aparte.

Cada celda de día con turnos muestra, de forma compacta (no hace falta el detalle completo, para eso está la vista de lista):
- El número del día.
- Un indicador chico por cada `ServiceSlot` de ese día: para `FIXED`/`YOUTH_SERVICE`, las iniciales o etiqueta corta de cada equipo asignado; para `EXTRAORDINARY`, el título del evento (truncado si hace falta). Usar el `colorHex` del uniforme del turno (si tiene) como acento visual del indicador — reutilizar el mismo criterio de `UniformBadge` (el color es refuerzo, nunca la única señal).
- Los días sin ningún turno quedan visualmente "vacíos" (sin indicadores), no hace falta un estado especial.

`EventsManager.jsx`: agregar un toggle simple "Vista de lista" / "Vista de calendario" (dos botones o un `Field as="select"`, lo que sea más simple de integrar con el resto de la pantalla) que alterna entre el `CalendarGrid` actual y este nuevo componente, ambos alimentados por el mismo `slots` ya cargado — no dispara ninguna llamada nueva a la API al cambiar de vista.

---

## 7. Fuera de alcance (a propósito)

- No se toca el comportamiento de `generate-teams` respecto al horario (ver nota de §5.2).
- No se agrega ningún endpoint de "asignar uniforme a una fecha completa" en el backend — la sincronización de "ambos servicios del día" es responsabilidad del frontend (§1.3, §1.5).
- La vista de calendario (§6) es de solo lectura respecto a asignaciones/uniformes — las acciones de editar siguen viviendo en la vista de lista (`ScheduleSlotCard`), no se duplican en la grilla mensual.
