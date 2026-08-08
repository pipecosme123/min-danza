# Fase 3 — Contrato cerrado de ciclo mensual y generación de equipos

**Estado:** cerrado para implementar. Referencia obligatoria para `backend-developer` y `frontend-developer`.
**Fecha:** 2026-08-08 (actualizado 2026-08-08 con el equipo de jóvenes, ver §9)
**Alcance:** `GET /api/months`, `POST /api/months`, `GET /api/months/:id`, `POST /api/months/:id/generate-teams`, `GET /api/months/:id/teams`, `PATCH /api/teams/:teamId`. La generación de `ServiceSlot` (horario/balance) es Fase 4 y no se toca aquí — a esta altura un `MonthCycle` recién creado no tiene slots.

Fuentes: `CLAUDE.md` §Equipos mensuales, `docs/architecture/phase1-schema-design.md` (esquema `MonthCycle`/`Team`/`TeamMember` ya migrado), stubs reales en `server/src/routes/months.routes.js` y `teams.routes.js`.

---

## 0. Invariantes que esta fase debe proteger

| # | Invariante | Cómo se protege |
|---|---|---|
| B1 | Un solo `MonthCycle` por `(year, month)` | `@@unique([year, month])` + chequeo previo → 409 `MES_YA_EXISTE` |
| B2 | Exactamente 1 `LEADER` por equipo (o ninguno si el equipo está vacío) | Validado en `generate-teams` y en `PATCH /teams/:teamId` (incluido el equipo `YOUTH`) |
| B3 | Una persona, un solo equipo **REGULAR** por mes (una persona SÍ puede estar además en el equipo `YOUTH` del mismo mes — ver §9) | Índice único **parcial** `team_member_one_regular_team_per_person` (`month_cycle_id, person_id` WHERE `team_type = 'REGULAR'`); `PATCH` mueve a la persona de su equipo anterior DEL MISMO `teamType` en la misma transacción |
| B4 | `manualOverride` solo lo escribe una acción manual, nunca el sorteo automático | `generate-teams` siempre persiste `manualOverride: false` para equipos `REGULAR`; `PATCH` lo calcula según P16 de abajo. El líder del equipo `YOUTH` es la única excepción: SIEMPRE se elige a mano (`manualOverride: true`), incluso al generarlo desde `generate-teams` (ver §9) |
| B5 | Mientras `status = DRAFT` se puede re-sortear y editar; `FINALIZED` congela el mes | `generate-teams` y `PATCH /teams/:teamId` devuelven 409 `MES_FINALIZADO` si no es `DRAFT` |

No existe todavía un endpoint que pase un mes a `FINALIZED` (llega en una fase posterior); por ahora todo `MonthCycle` nace y queda en `DRAFT`.

---

## 1. `GET /api/months`

Lista simple, sin paginación (volumen esperado: unas pocas decenas de meses en la vida del sistema).

**200 →**
```json
{ "data": [ { "id": "clx…", "year": 2026, "month": 8, "teamCount": 4, "status": "DRAFT", "finalizedAt": null, "youthTeamEnabled": true, "youthTeamSize": 10, "createdAt": "…", "updatedAt": "…" } ] }
```
Orden: `year desc, month desc` (más reciente primero).

`youthTeamEnabled`/`youthTeamSize` (ver §9) son el **último** `enabled`/`size` que se
pidió en `POST .../generate-teams` para el equipo de jóvenes de ESE mes — sirven solo
como default a precargar en el form del próximo (re)sorteo, no gobiernan nada por sí
solos. Nacen en `true`/`10` (default del `MonthCycle`) hasta el primer `generate-teams`.

## 2. `POST /api/months`

Body: `{ "year": 2026, "month": 8, "teamCount": 4 }`

| Campo | Reglas |
|---|---|
| `year` | entero, `2000..2100` |
| `month` | entero, `1..12` |
| `teamCount` | entero, `1..50` |

- **201** → DTO `MonthCycle` (igual forma que un elemento de `GET /api/months`), `status: "DRAFT"`.
- **409** `MES_YA_EXISTE` si ya hay un `MonthCycle` para ese `(year, month)` → `details: { monthCycleId }`.
- **400** validación zod estándar.

No se generan `Team` ni `ServiceSlot` al crear el mes; eso es explícitamente un paso posterior (sorteo manual del admin / Fase 4).

## 3. `GET /api/months/:id`

- **404** si no existe.
- **200** → mismo DTO que arriba.

## 4. `POST /api/months/:id/generate-teams`

Sortea (o re-sortea) líder/apoyo/ministros de todos los equipos del mes, y opcionalmente el equipo de jóvenes (`YOUTH`, ver §9). Idempotente en el sentido de que se puede volver a llamar mientras `status = DRAFT`: cada llamada **reemplaza por completo** el sorteo anterior (incluidas ediciones manuales previas — es una operación destructiva a propósito, "re-sortear" significa empezar de cero). El re-sorteo también borra y recrea el equipo `YOUTH` si existía.

Body (todo opcional):
```json
{ "youthTeam": { "enabled": true, "size": 10, "leaderPersonId": "clxLIDERJOVEN" } }
```
`youthTeam` ausente, o `{ "enabled": false }`, no genera ningún equipo `YOUTH` ese mes (comportamiento por defecto, sin cambios respecto al diseño original).

- **404** si el mes no existe.
- **409** `MES_FINALIZADO` si `status !== "DRAFT"`.
- **409** `POOL_INSTRUCTOR_INSUFICIENTE` si `count(Person activo, category=INSTRUCTOR) < teamCount` → `details: { available, needed }`. Sin instructores suficientes no hay forma de poner un líder por equipo; esto es un error duro, no un warning.
- **400** validación zod de `youthTeam` (`enabled` obligatorio boolean si el objeto está presente; `leaderPersonId` obligatorio cuando `enabled: true`; `size` entero `>= 1`, default `10`).
- Errores propios del equipo `YOUTH`: ver §9.

### Algoritmo (`teamGeneration.service.js`)

1. `instructorPool` = personas activas `category = INSTRUCTOR`. `ministroPool` = personas activas `category = MINISTRO`.
2. `previousCycle` = el `MonthCycle` más reciente con `(year, month)` estrictamente anterior al actual (si existe).
3. `previousLeaderIds` = `personId` de los `TeamMember` con `role = LEADER` de `previousCycle` (si `previousCycle` existe; si no, conjunto vacío).
4. `preferredLeaderPool` = `instructorPool` menos `previousLeaderIds`.
   - Si `preferredLeaderPool.length >= teamCount` → se sortea de ahí, sin warning.
   - Si no alcanza → se sortea del `instructorPool` completo (se relaja la restricción) y se agrega un warning `LIDER_REPETIDO_POSIBLE` explicando que no había suficientes instructores fuera del liderazgo del mes anterior.
5. Barajar (Fisher-Yates, `Math.random` — no hace falta CSPRNG acá) y tomar los primeros `teamCount` como líderes, uno por equipo.
6. El resto de `instructorPool` (los no sorteados como líder) se baraja y se reparte round-robin como `SUPPORT` (`i % teamCount`).
7. `ministroPool` se baraja y se reparte round-robin como `COLLABORATOR` (`i % teamCount`).
7b. Si `youthTeam.enabled`, arma el plan del equipo `YOUTH` (validaciones + sorteo del pool de colaboradores — ver §9) ANTES de escribir nada, con el mismo criterio que el paso 3 de arriba (`POOL_INSTRUCTOR_INSUFICIENTE` también se chequea antes de cualquier escritura).
8. En una transacción: borrar los `Team` existentes del mes — todos, `REGULAR` y `YOUTH` (cascada borra sus `TeamMember`; a esta altura del proyecto ningún `Team` tiene todavía `SlotAssignment`, así que no hay pérdida de horario — anotado para cuando exista Fase 4), crear `teamCount` equipos `REGULAR` nuevos (`label: "Equipo 1"…"Equipo N"`, `orderIndex: 1..N`), crear el equipo `YOUTH` si corresponde (`orderIndex: teamCount + 1`), crear los `TeamMember` (todos con `manualOverride: false`, salvo el líder de `YOUTH` que siempre lleva `manualOverride: true`), y persistir `MonthCycle.youthTeamEnabled`/`youthTeamSize` con lo pedido en esta llamada (solo como default para el próximo form).

**200 →**
```json
{
  "teams": [
    { "id": "clx…", "label": "Equipo 1", "orderIndex": 1, "teamType": "REGULAR",
      "members": [
        { "id": "clxTM1", "personId": "clxP1", "fullName": "Ana Gómez", "role": "LEADER", "manualOverride": false }
      ] },
    { "id": "clx…YOUTH", "label": "Servicio de jóvenes", "orderIndex": 5, "teamType": "YOUTH",
      "members": [
        { "id": "clxTM9", "personId": "clxP9", "fullName": "Sofía Ruiz", "role": "LEADER", "manualOverride": true },
        { "id": "clxTM10", "personId": "clxP10", "fullName": "Iván Paz", "role": "COLLABORATOR", "manualOverride": false }
      ] }
  ],
  "warnings": [
    { "code": "LIDER_REPETIDO_POSIBLE", "message": "…" },
    { "code": "JOVENES_REPETIDOS_POSIBLE", "message": "…" }
  ]
}
```
`warnings` siempre presente (puede ser `[]`). `teamType` es campo nuevo agregado a cada
elemento de `teams[]` (`"REGULAR" | "YOUTH"`) — el resto de la forma no cambió.

## 5. `GET /api/months/:id/teams`

- **404** si el mes no existe.
- **200** → `{ "teams": [ /* mismo shape que arriba, sin "warnings", incluye el equipo YOUTH si existe */ ] }`, ordenados por `orderIndex`. Si todavía no se sorteó, `teams: []` (no es error).

## 6. `PATCH /api/teams/:teamId`

Reemplaza el roster completo de un equipo puntual (mover gente entre equipos, cambiar roles, promover manualmente). Es la vía para "editar manualmente" del plan.

Body: `{ "members": [ { "personId": "clxP1", "role": "LEADER" }, … ] }`

- **404** `EQUIPO_NO_ENCONTRADO` si `teamId` no existe.
- **409** `MES_FINALIZADO` si el mes del equipo no está `DRAFT`.
- **400** validación:
  - `role` debe ser `LEADER | SUPPORT | COLLABORATOR`.
  - `personId` no puede repetirse dentro del body.
  - cada `personId` debe existir y estar `active: true` → si no, `PERSONA_NO_VALIDA` (`details: { personId }`).
  - si `members` no está vacío, debe haber **exactamente un** `LEADER` → `EQUIPO_SIN_LIDER` (cero) o `EQUIPO_MULTIPLES_LIDERES` (más de uno).
  - si el `Team` editado tiene `teamType: "YOUTH"`, ningún miembro puede traer `role: "SUPPORT"` → `ROL_INVALIDO_EQUIPO_JOVENES` (ese equipo solo admite `LEADER`/`COLLABORATOR`, ver §9).

### Lógica (`teamGeneration.service.js`, misma transacción)

1. Cargar el `Team` + su `monthCycle`; 404 / 409 según arriba (incluida la validación de `ROL_INVALIDO_EQUIPO_JOVENES`).
2. Para cada `personId` del body que hoy pertenezca a **otro** equipo del mismo mes **y del mismo `teamType`** que el editado, borrar esa fila (la persona "se muda" dentro de su mismo tipo de equipo — así nunca choca con el índice único parcial `team_member_one_regular_team_per_person`). Filtrado por `teamType` a propósito: editar el equipo `REGULAR` de alguien nunca debe tocar su membresía en `YOUTH`, y viceversa (pueden coexistir, ver §9).
3. Borrar del equipo editado los `TeamMember` que ya no están en el body.
4. Upsert (`create` o `update`) el resto con:
   - Si `team.teamType === "REGULAR"`: `manualOverride = (role === "LEADER" || role === "SUPPORT") ? person.category !== "INSTRUCTOR" : person.category !== "MINISTRO"` — es decir: se marca override cuando el rol asignado a mano no es el que el sorteo automático habría producido para la categoría de esa persona.
   - Si `team.teamType === "YOUTH"`: `manualOverride = true` siempre (no hay "categoría esperada" para este equipo — `isJoven` es independiente de `category` — así que cualquier edición manual de su roster es, por definición, una excepción manual).
   - En ambos casos se persiste `teamType` = `team.teamType` (denormalizado, igual que `monthCycleId`).

**200 →** `{ "team": { "id", "label", "orderIndex", "teamType", "members": [ … ] } }` (mismo shape que un elemento de `GET /api/months/:id/teams`).

---

## 7. Estructura de archivos a crear/tocar

```
server/src/
  services/teamGeneration.service.js   (nuevo)
  routes/months.routes.js              (reemplaza los 501)
  routes/teams.routes.js               (reemplaza los 501)
server/tests/
  months.test.js                       (nuevo) — POST/GET months, MES_YA_EXISTE
  teamGeneration.test.js               (nuevo) — sorteo, exclusión de líder anterior + relajación,
                                                  balance de reparto, PATCH manual, invariantes B1-B5
client/src/
  api/months.js                        (nuevo) — getMonths, createMonth, getMonth, getMonthTeams,
                                                  generateTeams, updateTeam
  pages/TeamGenerator.jsx              (reemplaza el placeholder)
client/src/tests/
  TeamGenerator.test.jsx               (nuevo)
```

`components/domain/TeamCard.jsx` y `MemberList.jsx` ya existen (de Fase 2, sin usar todavía) y ya calzan con el shape `{ id, fullName, role }` de arriba — reutilizarlos tal cual, no rehacerlos.

## 8. Fuera de alcance en esta fase (a propósito)

- Generación de `ServiceSlot` / balance de participaciones (Fase 4).
- Endpoint para pasar `MonthCycle` a `FINALIZED`.
- Edición de `teamCount` de un mes ya creado.
- Fecha/hora del evento del equipo de jóvenes (último sábado 6:50pm) y su uniforme: eso es `ServiceSlot`, llega en Fase 4. Esta fase solo arma el `Team`/`TeamMember` del equipo `YOUTH`, no su horario.

---

## 9. Equipo de jóvenes (`Team.teamType = "YOUTH"`)

Agregado el 2026-08-08. El "equipo de jóvenes" (antes modelado como roster manual del
evento especial del último sábado vía `SpecialSaturdayMember` — ESE modelo sigue
existiendo intacto para otra cosa y no se toca acá) ahora se arma como parte del MISMO
`POST /api/months/:id/generate-teams`, no como un flujo aparte.

### 9.1 Modelo

- `Person.isJoven` (`boolean`, default `false`): **independiente** de `category`. Pool de
  sorteo = `active: true AND isJoven: true`, sin filtrar por `category`.
- `TeamType` (`REGULAR | YOUTH`) en `Team.teamType` y, denormalizado, en
  `TeamMember.teamType` (mismo motivo que `TeamMember.monthCycleId`: habilita el índice
  único parcial sin JOIN).
- A lo sumo **un** `Team` con `teamType: YOUTH` por `MonthCycle` (no hay `@@unique`
  explícito para esto porque `generate-teams` es la única vía que crea equipos, y borra
  todo antes de recrear).
- El equipo `YOUTH` **solo** admite roles `LEADER` y `COLLABORATOR` — nunca `SUPPORT` (no
  tiene un pool de "apoyo" separado como los equipos `REGULAR`).
- Invariante B3 relajada a propósito: una persona puede estar en su equipo `REGULAR` **y**
  en el equipo `YOUTH` el mismo mes. Se protege con un índice único **parcial**
  (`team_member_one_regular_team_per_person`, `WHERE team_type = 'REGULAR'`) en vez del
  `@@unique([monthCycleId, personId])` original, que se retiró del schema.

### 9.2 Body de `generate-teams`

```json
{ "youthTeam": { "enabled": true, "size": 10, "leaderPersonId": "clxLIDERJOVEN" } }
```

| Campo | Obligatorio | Reglas |
|---|---|---|
| `enabled` | Sí, si `youthTeam` está presente | `boolean`. `false` (o `youthTeam` ausente) → no se crea equipo `YOUTH` ese mes. |
| `leaderPersonId` | Sí, si `enabled: true` | `string`. La persona debe existir, `active: true` e `isJoven: true` → si no, **400** `LIDER_JOVENES_INVALIDO`. |
| `size` | No | Entero `>= 1`, default `10`. El líder cuenta como 1 de ese `size` (colaboradores a sortear = `size - 1`). |

### 9.3 Algoritmo del equipo `YOUTH` (dentro del mismo `generate-teams`)

1. Validar `leaderPersonId` (existe, activo, `isJoven: true`) → si no, **400**
   `LIDER_JOVENES_INVALIDO`.
2. `jovenPool` = personas `active: true AND isJoven: true`, excluyendo al líder.
3. `totalAvailable = jovenPool.length + 1` (el líder). Si `totalAvailable < size` → **409**
   `POOL_JOVENES_INSUFICIENTE` (`details: { available, needed }`), sin crear nada.
4. `neededCollaborators = size - 1`.
5. Igual criterio que `previousLeaderIds` (§4 paso 2-3): `previousYouthMemberIds` =
   `personId` de los `TeamMember` con `teamType = YOUTH` del `previousCycle` (mismo mes
   calendario inmediatamente anterior).
6. `preferredJovenPool = jovenPool` menos `previousYouthMemberIds`.
   - Si alcanza (`>= neededCollaborators`) → se sortea de ahí, sin warning.
   - Si no alcanza → se sortea del `jovenPool` completo (se relaja la restricción) y se
     agrega un warning `JOVENES_REPETIDOS_POSIBLE`.
7. Barajar (Fisher-Yates) y tomar los primeros `neededCollaborators`.
8. Crear el `Team` (`teamType: YOUTH`, `label: "Servicio de jóvenes"`,
   `orderIndex: teamCount + 1`) y sus `TeamMember`: el líder con `role: LEADER`,
   `manualOverride: true` (elegido a mano, NUNCA por sorteo); cada colaborador sorteado
   con `role: COLLABORATOR`, `manualOverride: false`.

Todo esto corre en la MISMA transacción que arma los equipos `REGULAR` del mes: un fallo
en cualquier punto (incluido `POOL_JOVENES_INSUFICIENTE`) revierte TODO, incluidos los
equipos regulares que ya se habían armado en esta misma llamada.

### 9.4 Códigos de error/warning nuevos

| Código | HTTP | Dónde |
|---|---|---|
| `LIDER_JOVENES_INVALIDO` | 400 | `generate-teams`, cuando `leaderPersonId` no existe, no está activo, o `isJoven: false`. |
| `POOL_JOVENES_INSUFICIENTE` | 409 | `generate-teams`, cuando `active && isJoven` (incluido el líder) no alcanza para `size`. `details: { available, needed }`. |
| `JOVENES_REPETIDOS_POSIBLE` | — (warning, 200) | `generate-teams`, cuando se relajó la exclusión de quienes ya estuvieron en `YOUTH` el mes anterior. |
| `ROL_INVALIDO_EQUIPO_JOVENES` | 400 | `PATCH /api/teams/:teamId`, cuando el equipo es `YOUTH` y el body trae algún `role: "SUPPORT"`. |

### 9.5 Fuera de alcance de §9 (a propósito)

- Fecha/hora (último sábado 6:50pm) y uniforme del evento de jóvenes: es `ServiceSlot`,
  Fase 4.
- `SpecialSaturdayMember` no se toca ni se relaciona con nada de esto — sigue siendo un
  modelo aparte para otro propósito.
